import { DT, RADIUS, COUNT, halfWidth } from './geometry.js';
export { DT, RADIUS, COUNT, HEIGHT, PROFILE, outline, halfWidth } from './geometry.js';
const CELL = RADIUS * 2,
  COLS = Math.ceil(224 / CELL),
  ROWS = Math.ceil(444 / CELL),
  BLOCK_SIZE = 16,
  BLOCK_COLS = Math.ceil(COLS / BLOCK_SIZE),
  BLOCK_COUNT = BLOCK_COLS * Math.ceil(ROWS / BLOCK_SIZE),
  BLOCK_WORDS = Math.ceil(BLOCK_COUNT / 32);
const NEIGHBORS = [-1, 1, -COLS, COLS];
const directions = [];
for (let y = -3; y <= 3; y++)
  for (let x = -3; x <= 3; x++) {
    const length = Math.hypot(x, y);
    if (
      length &&
      length <= 3.7 &&
      (Math.abs(x) === 1 ||
        Math.abs(y) === 1 ||
        (Math.abs(x) === 3 && Math.abs(y) === 2) ||
        (Math.abs(x) === 2 && Math.abs(y) === 3))
    )
      directions.push({ x, y, length });
  }
// shortcut: a fixed lattice quantizes motion and repose; replace only if material calibration is required.
directions.forEach((d, i) => {
  d.bit = 1 << i;
});
const moveBits = new Uint32Array(9);
for (const d of directions)
  if (Math.abs(d.x) <= 1 && Math.abs(d.y) <= 1)
    moveBits[(d.y + 1) * 3 + d.x + 1] = d.bit;
export class Sand {
  constructor(count = COUNT) {
    if (!Number.isInteger(count) || count < 1 || count > COUNT)
      throw new RangeError('Invalid grain count');
    this.count = count;
    this.tick = 0;
    for (const name of ['x', 'y', 'vx', 'vy', 'carryX', 'carryY', 'travel', 'throatBudget'])
      this[name] = new Float64Array(count);
    this.cell = new Int32Array(count);
    this.grid = new Int32Array(COLS * ROWS);
    this.valid = new Uint8Array(COLS * ROWS);
    this.resting = new Uint8Array(count);
    this.failed = new Uint32Array(count);
    this.failedTerminal = new Int32Array(count * directions.length);
    this.failedWaiting = new Uint32Array(count);
    this.chain = new Int32Array(count);
    this.grounded = new Uint8Array(count);
    this.previousGrounded = new Uint8Array(count);
    this.active = new Uint8Array(count);
    this.budgetTick = new Float64Array(count);
    this.subscribers = new Uint32Array(BLOCK_COUNT * BLOCK_WORDS);
    this.changedBlocks = new Uint8Array(BLOCK_COUNT);
    this.wakeBlocks = new Uint32Array(BLOCK_WORDS);
    this.dependencies = new Uint32Array(BLOCK_WORDS);
    this.cellBlocks = new Uint16Array(COLS * ROWS);
    this.queue = new Int32Array(count);
    this.order = new Int32Array(count);
    this.activeOrder = new Int32Array(count);
    this.requests = new Int32Array(count);
    this.random = 123456789;
    for (let cy = 0; cy < ROWS; cy++)
      for (let cx = 0; cx < COLS; cx++) {
        let k = cy * COLS + cx;
        this.cellBlocks[k] = Math.floor(cy / BLOCK_SIZE) * BLOCK_COLS + Math.floor(cx / BLOCK_SIZE);
        this.valid[k] =
          Math.abs(this.worldY(cy)) < 220 - RADIUS &&
          Math.abs(this.worldX(cx)) < halfWidth(this.worldY(cy)) - RADIUS;
      }
    this.gx = NaN;
    this.gy = NaN;
    this.reset();
  }
  worldX(cx) {
    return (cx + 0.5) * CELL - 112;
  }
  worldY(cy) {
    return (cy + 0.5) * CELL - 222;
  }
  index(x, y) {
    const cx = Math.floor((x + 112) / CELL),
      cy = Math.floor((y + 222) / CELL);
    return cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS ? cy * COLS + cx : -1;
  }
  reset() {
    this.resting.fill(0);
    this.grid.fill(0);
    for (const name of ['vx', 'vy', 'carryX', 'carryY', 'travel', 'throatBudget'])
      this[name].fill(0);
    this.budgetTick.fill(0);
    this.random = 123456789;
    for (let i = 0; i < this.count; i++) this.order[i] = i;
    for (const name of ['grounded', 'previousGrounded']) this[name].fill(0);
    this.tick = 0;
    this.lastUpdatedCount = 0;
    let i = 0;
    for (let cy = Math.floor((222 - 9) / CELL); cy >= 0 && i < this.count; cy--)
      for (let cx = 0; cx < COLS && i < this.count; cx++) {
        const k = cy * COLS + cx;
        if (!this.valid[k]) continue;
        this.cell[i] = k;
        this.grid[k] = i + 1;
        this.x[i] = this.worldX(cx);
        this.y[i++] = this.worldY(cy);
      }
    if (i < this.count) throw new RangeError('Grains exceed vessel capacity');
    this.wakeAll();
  }
  wakeAll() {
    this.active.fill(1);
    this.resting.fill(0);
    this.failed.fill(0);
    this.failedWaiting.fill(0);
    this.subscribers.fill(0);
    this.changedBlocks.fill(0);
    this.activeCount = this.count;
    this.sleeping = false;
    for (let i = 0; i < this.count; i++) {
      this.activeOrder[i] = i;
      this.accrueBudget(i);
    }
  }
  accrueBudget(i) {
    if (this.budgetTick[i] === this.tick) return;
    // Dormant grains still earn the same bounded neck budget.
    this.throatBudget[i] = Math.min(
      4,
      this.throatBudget[i] + ((this.tick - this.budgetTick[i]) * 80 * DT) / CELL
    );
    this.budgetTick[i] = this.tick;
  }
  block(k) {
    return this.cellBlocks[k];
  }
  wake(i) {
    if (!this.active[i]) this.activeOrder[this.activeCount++] = i;
    this.active[i] = 1;
  }
  subscribe(source) {
    const start = this.cell[source],
      owner = this.cellBlocks[start],
      word = owner >>> 5,
      mask = 1 << (owner & 31);
    // Keep the normal whole-owner wakeup, without building dependencies that it would discard.
    if (this.changedBlocks[owner]) {
      this.subscribers[owner * BLOCK_WORDS + word] |= mask;
      return false;
    }
    this.dependencies.fill(0);
    let bits = this.failed[source];
    while (bits) {
      const bit = bits & -bits,
        index = 31 - Math.clz32(bit),
        direction = directions[index],
        terminal = this.failedTerminal[source * directions.length + index];
      bits ^= bit;
      let cx = start % COLS,
        cy = Math.floor(start / COLS),
        remaining = direction.x
          ? ((terminal % COLS) - cx) / direction.x
          : (Math.floor(terminal / COLS) - cy) / direction.y;
      // Follow only lattice points on this request, jumping between visited blocks.
      for (;;) {
        const dependency = this.cellBlocks[cy * COLS + cx];
        if (this.changedBlocks[dependency]) {
          this.subscribers[dependency * BLOCK_WORDS + word] |= mask;
          return false;
        }
        this.dependencies[dependency >>> 5] |= 1 << (dependency & 31);
        if (remaining === 0) break;
        const tx = direction.x > 0
            ? Math.floor((BLOCK_SIZE - 1 - (cx % BLOCK_SIZE)) / direction.x) + 1
            : direction.x < 0
              ? Math.floor((cx % BLOCK_SIZE) / -direction.x) + 1
              : Infinity,
          ty = direction.y > 0
            ? Math.floor((BLOCK_SIZE - 1 - (cy % BLOCK_SIZE)) / direction.y) + 1
            : direction.y < 0
              ? Math.floor((cy % BLOCK_SIZE) / -direction.y) + 1
              : Infinity,
          jump = Math.min(tx, ty, remaining);
        cx += direction.x * jump;
        cy += direction.y * jump;
        remaining -= jump;
      }
    }
    for (let w = 0; w < BLOCK_WORDS; w++) {
      let pending = this.dependencies[w];
      while (pending) {
        const bit = pending & -pending,
          dependency = w * 32 + 31 - Math.clz32(bit);
        pending ^= bit;
        this.subscribers[dependency * BLOCK_WORDS + word] |= mask;
      }
    }
    return true;
  }
  fail(length, bit, terminal, waiting = false) {
    if (waiting) this.throatWaiting = true;
    const index = 31 - Math.clz32(bit);
    for (let a = 0; a < length; a++) {
      const id = this.chain[a];
      this.failed[id] |= bit;
      this.failedTerminal[id * directions.length + index] = terminal;
      if (waiting) this.failedWaiting[id] |= bit;
    }
    return false;
  }
  wakeChangedBlocks() {
    this.wakeBlocks.fill(0);
    for (let b = 0; b < BLOCK_COUNT; b++) {
      if (!this.changedBlocks[b]) continue;
      this.changedBlocks[b] = 0;
      for (let w = 0; w < BLOCK_WORDS; w++)
        this.wakeBlocks[w] |= this.subscribers[b * BLOCK_WORDS + w];
    }
    for (let w = 0; w < BLOCK_WORDS; w++) {
      let bits = this.wakeBlocks[w];
      while (bits) {
        const bit = bits & -bits,
          b = w * 32 + 31 - Math.clz32(bit);
        bits ^= bit;
        // Clearing an owner's subscriptions also wakes all its sleepers. Storage stays bounded.
        for (let dependency = 0; dependency < BLOCK_COUNT; dependency++)
          this.subscribers[dependency * BLOCK_WORDS + w] &= ~bit;
        const x0 = (b % BLOCK_COLS) * BLOCK_SIZE,
          y0 = Math.floor(b / BLOCK_COLS) * BLOCK_SIZE;
        for (let y = y0; y < Math.min(y0 + BLOCK_SIZE, ROWS); y++)
          for (let x = x0; x < Math.min(x0 + BLOCK_SIZE, COLS); x++) {
            const i = this.grid[y * COLS + x] - 1;
            if (i >= 0) this.wake(i);
          }
      }
    }
  }
  // Resolve an occupied destination as a whole chain, not a stationary neighbour.
  push(i, dx, dy, bit, commit = true, account = true) {
    const distance = Math.hypot(dx, dy);
    // A supported bed yields sideways under pressure, but can lift off against gravity.
    const restrict =
      dx * this.gx + dy * this.gy > 0 &&
      Math.abs(dx * this.gy - dy * this.gx) < 0.342 * distance * this.gravityMagnitude;
    let length = 0,
      id = i;
    while (id >= 0) {
      const k = this.cell[id];
      if (id !== i && restrict && this.grounded[id]) return this.fail(length, bit, k);
      if (this.failed[id] & bit) {
        const terminal = this.failedTerminal[id * directions.length + 31 - Math.clz32(bit)];
        return this.fail(length, bit, terminal, !!(this.failedWaiting[id] & bit));
      }
      this.chain[length++] = id;
      const cx = (k % COLS) + dx,
        cy = Math.floor(k / COLS) + dy;
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return this.fail(length, bit, k);
      const next = cy * COLS + cx;
      // Terminal wall cells must remain part of the failed request's ray.
      if (!this.valid[next]) return this.fail(length, bit, next);
      if (Math.min(Math.abs(this.y[id]), Math.abs(this.y[id] + dy * CELL)) < 8) {
        this.accrueBudget(id);
        if (this.throatBudget[id] < distance) return this.fail(length, bit, next, true);
      }
      id = this.grid[next] - 1;
    }
    if (!commit) return true;
    for (let a = length - 1; a >= 0; a--) {
      const j = this.chain[a],
        old = this.cell[j],
        next = old + dx + dy * COLS;
      this.changedBlocks[this.block(old)] = 1;
      this.changedBlocks[this.block(next)] = 1;
      this.wake(j);
      this.grid[old] = 0;
      this.grid[next] = j + 1;
      this.cell[j] = next;
      if (Math.min(Math.abs(this.y[j]), Math.abs(this.y[j] + dy * CELL)) < 8)
        this.throatBudget[j] -= distance;
      this.x[j] = this.worldX(next % COLS);
      this.y[j] = this.worldY(Math.floor(next / COLS));
      if (account) {
        this.carryX[j] -= dx;
        this.carryY[j] -= dy;
      }
      this.failed[j] = 0;
      this.failedWaiting[j] = 0;
      this.resting[j] = 0;
    }
    return true;
  }
  step(gx = 0, gy = 650, normal = 0) {
    if (
      ![gx, gy, normal].every(Number.isFinite) ||
      normal < 0 ||
      Math.hypot(gx, gy, normal) > 5200 + 1e-6
    )
      throw new RangeError('Invalid gravity');
    this.tick++;
    const magnitude = Math.hypot(gx, gy);
    const plateLimit = 0.45 * normal;
    // Drag precedes static friction; wake when either region can start from rest.
    const plateState =
      Number(magnitude > plateLimit) |
      (Number(magnitude > plateLimit * (1 + 0.35 * DT)) << 1) |
      (Number(magnitude > plateLimit * (1 + 18 * DT)) << 2);
    if (
      !Number.isFinite(this.gx) ||
      plateState !== this.plateState ||
      Math.hypot(gx - this.gx, gy - this.gy, normal - (this.normal || 0)) > 2
    ) {
      this.wakeAll();
      this.gx = gx;
      this.gy = gy;
      this.normal = normal;
      this.gravityMagnitude = magnitude;
      this.plateState = plateState;
      this.surfaceDirections = directions
        .map((d) => ({
          ...d,
          along: (d.x * gx + d.y * gy) / (magnitude || 1),
          cross: Math.abs(d.x * gy - d.y * gx) / (magnitude || 1)
        }))
        .filter((d) => d.along > 0.64 * d.cross)
        .sort((a, b) => a.along / (a.cross || 1e-9) - b.along / (b.cross || 1e-9));
    }
    this.lastUpdatedCount = 0;
    if (this.sleeping) return;
    this.failed.fill(0);
    this.failedWaiting.fill(0);
    const previous = this.previousGrounded;
    this.previousGrounded = this.grounded;
    this.grounded = previous;
    this.grounded.fill(0);
    let tail = 0;
    const forward = Math.abs(gx) > Math.abs(gy) ? Math.sign(gx) : Math.sign(gy) * COLS;
    if (magnitude > 0) {
      for (let i = 0; i < this.count; i++)
        if (!this.valid[this.cell[i] + forward]) {
          this.grounded[i] = 1;
          this.queue[tail++] = i;
        }
      for (let q = 0; q < tail; q++) {
        const k = this.cell[this.queue[q]];
        for (const offset of NEIGHBORS) {
          const j = this.grid[k + offset] - 1;
          if (j >= 0 && !this.grounded[j]) {
            this.grounded[j] = 1;
            this.queue[tail++] = j;
          }
        }
      }
    }
    let moving = false;
    for (let i = 0; i < this.count; i++)
      if (this.previousGrounded[i] && !this.grounded[i]) {
        this.changedBlocks[this.block(this.cell[i])] = 1;
        this.resting[i] = 0;
        this.wake(i);
      }
    // Predict the initial active set before any chain push. Push wakeups run next step.
    const updated = this.activeCount;
    this.lastUpdatedCount = updated;
    for (let a = 0; a < updated; a++) {
      const i = this.activeOrder[a];
      this.accrueBudget(i);
      const drag = 1 / (1 + (Math.abs(this.y[i]) < 7 ? 18 : 0.35) * DT);
      let vx = (this.vx[i] + gx * DT) * drag,
        vy = (this.vy[i] + gy * DT) * drag,
        speed = Math.hypot(vx, vy);
      const friction =
        speed <= 0.45 * normal * DT ? 0 : Math.max(0, 1 - (0.35 * normal * DT) / (speed || 1));
      vx *= friction;
      vy *= friction;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.carryX[i] += (vx * DT) / CELL;
      this.carryY[i] += (vy * DT) / CELL;
    }
    // Shuffle pressure/yield requests so the centre column cannot monopolize a narrow outlet.
    for (let a = this.count - 1; a > 0; a--) {
      this.random = (Math.imul(this.random, 1664525) + 1013904223) >>> 0;
      const b = this.random % (a + 1),
        value = this.order[a];
      this.order[a] = this.order[b];
      this.order[b] = value;
    }
    let requested = 0;
    for (let a = 0; a < this.count; a++) {
      const i = this.order[a];
      if (this.active[i] === 1) this.requests[requested++] = i;
    }
    for (let a = 0; a < updated; a++) {
      const i = this.requests[a];
      this.throatWaiting = false;
      let blocked = !!this.resting[i];
      for (let n = 0; n < 16; n++) {
        const dx =
            Math.abs(this.carryX[i]) >= 1 && this.carryX[i] * this.vx[i] > 0
              ? Math.sign(this.carryX[i])
              : 0,
          dy =
            Math.abs(this.carryY[i]) >= 1 && this.carryY[i] * this.vy[i] > 0
              ? Math.sign(this.carryY[i])
              : 0;
        if (!dx && !dy) break;
        if (!this.push(i, dx, dy, moveBits[(dy + 1) * 3 + dx + 1])) {
          blocked = true;
          break;
        }
        blocked = false;
      }
      if (!blocked) {
        const held = magnitude <= plateLimit * (1 + (Math.abs(this.y[i]) < 7 ? 18 : 0.35) * DT);
        if (held && this.vx[i] === 0 && this.vy[i] === 0) {
          this.carryX[i] = this.carryY[i] = this.travel[i] = 0;
          this.active[i] = 2;
        }
        continue;
      }
      this.resting[i] = 1;
      this.vx[i] = this.vy[i] = this.carryX[i] = this.carryY[i] = 0;
      let slide;
      for (const direction of this.surfaceDirections)
        if (this.push(i, direction.x, direction.y, direction.bit, false)) {
          slide = direction;
          break;
        }
      if (slide && magnitude > 0.45 * normal) {
        this.travel[i] += Math.sqrt(magnitude) * 8 * DT;
        if (this.travel[i] >= slide.length * CELL) {
          this.push(i, slide.x, slide.y, slide.bit, true, false);
          this.travel[i] = 0;
          this.resting[i] = 0;
        }
      } else {
        this.travel[i] = 0;
        if ((this.grounded[i] || magnitude === 0) && !this.throatWaiting) {
          if (magnitude > 0.45 * normal && !this.subscribe(i)) continue;
          // State 2 retains the list slot until compaction, avoiding duplicate wakeups.
          this.active[i] = 2;
        }
      }
    }
    this.wakeChangedBlocks();
    let retained = 0;
    for (let a = 0; a < this.activeCount; a++) {
      const i = this.activeOrder[a];
      if (this.active[i] === 1) {
        this.activeOrder[retained++] = i;
        moving = true;
      } else this.active[i] = 0;
    }
    this.activeCount = retained;
    this.sleeping = !moving;
  }
  snapshot() {
    const data = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i++) {
      data[2 * i] = this.x[i];
      data[2 * i + 1] = this.y[i];
    }
    return data;
  }
}
