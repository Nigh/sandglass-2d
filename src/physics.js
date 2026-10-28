export const DT = 1 / 480;
export const RADIUS = 2.2;
export const HEIGHT = 440;
export const COUNT = 1200;
export const PROFILE = [[-220, 104], [-190, 108], [-135, 93], [-75, 49], [-12, 14], [12, 14], [75, 49], [135, 93], [190, 108], [220, 104]];
export const outline = [
  ...PROFILE.map(([y, x]) => [-x, y]),
  ...[...PROFILE].reverse().map(([y, x]) => [x, y]),
];
export function halfWidth(y) {
  for (let i = 1; i < PROFILE.length; i++) {
    if (y <= PROFILE[i][0]) {
      const [a, x] = PROFILE[i - 1], [b, z] = PROFILE[i];
      return x + (z - x) * (y - a) / (b - a);
    }
  }
  return PROFILE.at(-1)[1];
}
const CELL = RADIUS * 2.1, COLS = 52, ROWS = 104;
const K = 60000, DAMP = 45, KT = 20000, MU = 0.42;
// shortcut: discs use effective angular-grain friction without spin; use polygon DEM for material calibration.
export class Sand {
  constructor(count = COUNT) {
    if (!Number.isInteger(count) || count < 1 || count > 2400) throw new RangeError('Invalid grain count');
    this.count = count;
    this.x = new Float64Array(count); this.y = new Float64Array(count);
    this.vx = new Float64Array(count); this.vy = new Float64Array(count);
    this.fx = new Float64Array(count); this.fy = new Float64Array(count);
    this.head = new Int32Array(COLS * ROWS); this.next = new Int32Array(count);
    this.contacts = new Map(); this.tick = 0;
    this.walls = outline.map((a, i, points) => {
      const b = points[(i + 1) % points.length], dx = b[0] - a[0], dy = b[1] - a[1];
      return { x: a[0], y: a[1], dx, dy, length2: dx * dx + dy * dy };
    });
    this.reset();
  }
  reset() {
    this.vx.fill(0); this.vy.fill(0); this.contacts.clear();
    let i = 0, row = 0;
    for (let y = -19; y > -217 && i < this.count; y -= RADIUS * 1.79) {
      const width = halfWidth(y) - RADIUS * 1.5;
      for (let x = -width + (row % 2) * RADIUS; x <= width && i < this.count; x += RADIUS * 2.06) {
        this.x[i] = x; this.y[i++] = y;
      }
      row++;
    }
    if (i < this.count) throw new RangeError('Grains exceed vessel capacity');
  }
  contact(i, j, nx, ny, depth, key) {
    const vx = this.vx[i] - (j < 0 ? 0 : this.vx[j]);
    const vy = this.vy[i] - (j < 0 ? 0 : this.vy[j]);
    const normal = Math.max(0, K * depth - DAMP * (vx * nx + vy * ny));
    let c = this.contacts.get(key);
    if (!c || c.tick !== this.tick - 1) c = { displacement: 0, tick: this.tick };
    const tangentSpeed = -vx * ny + vy * nx;
    c.displacement += tangentSpeed * DT;
    const limit = (j < 0 ? 0.12 : MU) * normal;
    const friction = Math.max(-limit, Math.min(limit, -KT * c.displacement - 18 * tangentSpeed));
    c.displacement = -(friction + 18 * tangentSpeed) / KT;
    c.tick = this.tick; this.contacts.set(key, c);
    const fx = normal * nx - friction * ny, fy = normal * ny + friction * nx;
    this.fx[i] += fx; this.fy[i] += fy;
    if (j >= 0) { this.fx[j] -= fx; this.fy[j] -= fy; }
  }
  step(gx = 0, gy = 650) {
    if (!Number.isFinite(gx) || !Number.isFinite(gy) || Math.hypot(gx, gy) > 2600) throw new RangeError('Invalid gravity');
    this.tick++; this.head.fill(-1); this.fx.fill(gx); this.fy.fill(gy);
    for (let i = 0; i < this.count; i++) {
      const cx = Math.max(0, Math.min(COLS - 1, Math.floor((this.x[i] + 120) / CELL)));
      const cy = Math.max(0, Math.min(ROWS - 1, Math.floor((this.y[i] + 230) / CELL)));
      const cell = cy * COLS + cx;
      this.next[i] = this.head[cell]; this.head[cell] = i;
    }
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i], y = this.y[i];
      const cx = Math.max(0, Math.min(COLS - 1, Math.floor((x + 120) / CELL)));
      const cy = Math.max(0, Math.min(ROWS - 1, Math.floor((y + 230) / CELL)));
      for (let oy = Math.max(0, cy - 1); oy <= Math.min(ROWS - 1, cy + 1); oy++) {
        for (let ox = Math.max(0, cx - 1); ox <= Math.min(COLS - 1, cx + 1); ox++) {
          for (let j = this.head[oy * COLS + ox]; j >= 0; j = this.next[j]) {
            if (j >= i) continue;
            const dx = x - this.x[j], dy = y - this.y[j], d2 = dx * dx + dy * dy;
            if (d2 >= RADIUS * RADIUS * 4) continue;
            const d = Math.sqrt(d2);
            this.contact(i, j, d ? dx / d : 1, d ? dy / d : 0, RADIUS * 2 - d, i * this.count + j);
          }
        }
      }
      let nearest = Infinity, wallIndex = 0, wallX = 0, wallY = 0;
      for (let w = 0; w < this.walls.length; w++) {
        const wall = this.walls[w];
        const t = Math.max(0, Math.min(1, ((x - wall.x) * wall.dx + (y - wall.y) * wall.dy) / wall.length2));
        const px = wall.x + wall.dx * t, py = wall.y + wall.dy * t;
        const d2 = (x - px) ** 2 + (y - py) ** 2;
        if (d2 < nearest) { nearest = d2; wallIndex = w; wallX = px; wallY = py; }
      }
      const inside = Math.abs(y) <= 220 && Math.abs(x) <= halfWidth(y);
      const distance = Math.sqrt(nearest);
      if (distance < RADIUS || !inside) {
        const wall = this.walls[wallIndex], length = Math.sqrt(wall.length2);
        const sign = inside ? 1 : -1;
        const nx = distance > 1e-9 ? (x - wallX) / distance * sign : wall.dy / length;
        const ny = distance > 1e-9 ? (y - wallY) / distance * sign : -wall.dx / length;
        this.contact(i, -1, nx, ny, RADIUS - sign * distance, -1 - i * this.walls.length - wallIndex);
        // Keep high-speed impacts on the interior side of the zero-thickness glass.
        if (!inside) {
          this.x[i] = wallX + nx * RADIUS; this.y[i] = wallY + ny * RADIUS;
          const vn = this.vx[i] * nx + this.vy[i] * ny;
          if (vn < 0) { this.vx[i] -= vn * nx; this.vy[i] -= vn * ny; }
        }
      }
    }
    for (const [key, c] of this.contacts) if (c.tick !== this.tick) this.contacts.delete(key);
    for (let i = 0; i < this.count; i++) {
      this.vx[i] = (this.vx[i] + this.fx[i] * DT) * 0.9998;
      this.vy[i] = (this.vy[i] + this.fy[i] * DT) * 0.9998;
      this.x[i] += this.vx[i] * DT; this.y[i] += this.vy[i] * DT;
    }
  }
  snapshot() {
    const data = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i++) { data[i * 2] = this.x[i]; data[i * 2 + 1] = this.y[i]; }
    return data;
  }
}
