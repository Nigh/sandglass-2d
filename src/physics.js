import { DT, RADIUS, COUNT, halfWidth } from './geometry.js';
export { DT, RADIUS, COUNT, HEIGHT, PROFILE, outline, halfWidth } from './geometry.js';
const CELL = RADIUS * 2,
  COLS = Math.ceil(224 / CELL),
  ROWS = Math.ceil(444 / CELL);
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
    this.chain = new Int32Array(count);
    this.grounded = new Uint8Array(count);
    this.queue = new Int32Array(count);
    this.order = Int32Array.from({ length: count }, (_, i) => i);
    this.random = 123456789;
    for (let cy = 0; cy < ROWS; cy++)
      for (let cx = 0; cx < COLS; cx++) {
        let k = cy * COLS + cx;
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
    this.sleeping = false;
    this.random = 123456789;
    for (let i = 0; i < this.count; i++) this.order[i] = i;
    this.tick = 0;
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
      if (id !== i && restrict && this.grounded[id]) {
        for (let a = 0; a < length; a++) this.failed[this.chain[a]] |= bit;
        return false;
      }
      if (this.failed[id] & bit) {
        for (let a = 0; a < length; a++) this.failed[this.chain[a]] |= bit;
        return false;
      }
      this.chain[length++] = id;
      const k = this.cell[id],
        cx = (k % COLS) + dx,
        cy = Math.floor(k / COLS) + dy;
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS || !this.valid[cy * COLS + cx]) {
        for (let a = 0; a < length; a++) this.failed[this.chain[a]] |= bit;
        return false;
      }
      if (
        Math.min(Math.abs(this.y[id]), Math.abs(this.y[id] + dy * CELL)) < 8 &&
        this.throatBudget[id] < distance
      ) {
        this.waitingForThroat = true;
        for (let a = 0; a < length; a++) this.failed[this.chain[a]] |= bit;
        return false;
      }
      id = this.grid[cy * COLS + cx] - 1;
    }
    if (!commit) return true;
    for (let a = length - 1; a >= 0; a--) {
      const j = this.chain[a],
        old = this.cell[j],
        next = old + dx + dy * COLS;
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
      this.resting[j] = 0;
    }
    return true;
  }
  step(gx = 0, gy = 650, normal = 0) {
    if (
      ![gx, gy, normal].every(Number.isFinite) ||
      normal < 0 ||
      Math.hypot(gx, gy, normal) > 2600 + 1e-6
    )
      throw new RangeError('Invalid gravity');
    this.tick++;
    const magnitude = Math.hypot(gx, gy);
    if (
      !Number.isFinite(this.gx) ||
      Math.hypot(gx - this.gx, gy - this.gy, normal - (this.normal || 0)) > 2
    ) {
      this.sleeping = false;
      this.resting.fill(0);
      this.gx = gx;
      this.gy = gy;
      this.normal = normal;
      this.gravityMagnitude = magnitude;
      this.surfaceDirections = directions
        .map((d) => ({
          ...d,
          along: (d.x * gx + d.y * gy) / (magnitude || 1),
          cross: Math.abs(d.x * gy - d.y * gx) / (magnitude || 1)
        }))
        .filter((d) => d.along > 0.64 * d.cross)
        .sort((a, b) => a.along / (a.cross || 1e-9) - b.along / (b.cross || 1e-9));
    }
    if (this.sleeping) return;
    this.failed.fill(0);
    this.waitingForThroat = false;
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
    // Predict every particle before resolving any occupancy dependency.
    for (let i = 0; i < this.count; i++) {
      // shortcut: a local speed budget approximates unresolved friction in the four-grain-wide neck.
      this.throatBudget[i] = Math.min(4, this.throatBudget[i] + (80 * DT) / CELL);
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
    for (let a = 0; a < this.count; a++) {
      const i = this.order[a];
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
        const direction = directions.find((d) => d.x === dx && d.y === dy);
        if (!this.push(i, dx, dy, direction.bit)) {
          blocked = true;
          break;
        }
        blocked = false;
        moving = true;
      }
      if (!blocked) {
        moving ||= Math.hypot(this.vx[i], this.vy[i]) > 0.01;
        continue;
      }
      this.resting[i] = 1;
      this.vx[i] = this.vy[i] = this.carryX[i] = this.carryY[i] = 0;
      const slide = this.surfaceDirections.find((d) => this.push(i, d.x, d.y, d.bit, false));
      if (slide && magnitude > 0.45 * normal) {
        this.travel[i] += Math.sqrt(magnitude) * 8 * DT;
        if (this.travel[i] >= slide.length * CELL) {
          this.push(i, slide.x, slide.y, slide.bit, true, false);
          this.travel[i] = 0;
          this.resting[i] = 0;
        }
        moving = true;
      } else this.travel[i] = 0;
    }
    this.sleeping = !moving && !this.waitingForThroat;
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
