import test from 'node:test';
import assert from 'node:assert/strict';
import { Sand, DT, RADIUS } from '../src/physics.js';

const CELL = RADIUS * 2;
const COLS = Math.ceil(224 / CELL);
const at = (x, y) => y * COLS + x;

function fixture(cells, valid = cells) {
  const sand = new Sand(cells.length);
  sand.valid.fill(0);
  for (const cell of valid) sand.valid[cell] = 1;
  sand.grid.fill(0);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    sand.cell[i] = cell;
    sand.grid[cell] = i + 1;
    sand.x[i] = sand.worldX(cell % COLS);
    sand.y[i] = sand.worldY(Math.floor(cell / COLS));
  }
  sand.resting.fill(1);
  sand.wakeAll();
  return sand;
}

function conserved(sand) {
  assert.equal(new Set(sand.cell).size, sand.count, 'grains must keep distinct cells');
  for (let i = 0; i < sand.count; i++) {
    assert.equal(sand.grid[sand.cell[i]], i + 1);
    assert.ok(sand.valid[sand.cell[i]], 'grain escaped fixture');
    assert.equal(sand.index(sand.x[i], sand.y[i]), sand.cell[i]);
    assert.ok(Number.isFinite(sand.vx[i]) && Number.isFinite(sand.vy[i]));
  }
}

test('removing a distant bridge wakes a supported island and lets it fall', () => {
  const cells = [];
  for (let y = 78; y <= 125; y++) cells.push(at(80, y));
  const parking = at(90, 125);
  const sand = fixture(cells, [...cells, parking]);
  for (let n = 0; n < 12 && !sand.sleeping; n++) sand.step();
  assert.ok(sand.sleeping, 'intact supported structure must reach rest');
  const island = sand.y.slice(0, 6);
  const bridge = sand.grid[at(80, 119)] - 1;
  assert.ok(bridge >= 0);
  sand.grid[sand.cell[bridge]] = 0;
  sand.cell[bridge] = parking;
  sand.grid[parking] = bridge + 1;
  sand.x[bridge] = sand.worldX(parking % COLS);
  sand.y[bridge] = sand.worldY(Math.floor(parking / COLS));
  sand.wakeAll();
  for (let n = 0; n < 120; n++) sand.step();
  assert.ok(sand.y[0] > island[0], 'island over 40 cells from bridge must fall into vacancy');
  conserved(sand);
});

test('one airborne grain keeps inertia without moving or updating the whole supported bed', () => {
  const valid = [], cells = [];
  for (let y = 250; y <= 279; y++)
    for (let x = 72; x <= 95; x++) {
      valid.push(at(x, y));
      if (y >= 277) cells.push(at(x, y));
    }
  cells.push(at(84, 256));
  const sand = fixture(cells, valid);
  const airborne = sand.count - 1;
  sand.resting[airborne] = 0;
  sand.vx[airborne] = 10;
  sand.vy[airborne] = 24;
  let vx = 10, vy = 24;
  const bed = sand.cell.slice(0, airborne);
  const initialY = sand.y[airborne];
  let sparseSteps = 0;
  for (let n = 0; n < 12; n++) {
    vx /= 1 + 0.35 * DT;
    vy = (vy + 650 * DT) / (1 + 0.35 * DT);
    sand.step();
    assert.ok(Math.abs(sand.vx[airborne] - vx) < 1e-9, 'sleeping neighbours must not erase horizontal inertia');
    assert.ok(Math.abs(sand.vy[airborne] - vy) < 1e-9, 'airborne velocity must follow free fall');
    assert.deepEqual(sand.cell.subarray(0, airborne), bed, 'supported bed must remain fixed');
    if (sand.lastUpdatedCount < sand.count / 4) sparseSteps++;
    assert.equal(sand.sleeping, false, 'airborne grain must keep simulation awake');
  }
  assert.ok(sand.y[airborne] > initialY + CELL, 'airborne grain must actually move');
  assert.ok(sparseSteps >= 4, 'most steps must update far fewer grains than the bed contains');
  conserved(sand);
});

test('a moving terminal blocker releases sleeping grains across a long diagonal chain', () => {
  const cells = Array.from({ length: 31 }, (_, i) => at(64 + i, 250 + i));
  const terminal = cells.length - 1;
  const outlet = at(95, 280);
  const sand = fixture(cells, [...cells, outlet]);
  // Initialize gravity before constructing an already settled diagonal shelf.
  sand.step(0, 10);
  for (const name of ['vx', 'vy', 'carryX', 'carryY']) sand[name].fill(0);
  sand.wakeAll();
  sand.resting.fill(1);
  sand.resting[terminal] = 0;
  sand.vx[terminal] = 20;
  const sourceY = sand.y[0];
  for (let n = 0; n < 3; n++) sand.step(0, 10);
  assert.equal(sand.cell[0], cells[0], 'source must remain blocked before terminal moves');
  assert.equal(sand.cell[terminal], cells[terminal], 'terminal must wait long enough for source to reach rest');
  sand.step(0, 10);
  assert.equal(sand.cell[terminal], outlet, 'terminal must vacate chain through its own inertia');
  for (let n = 0; n < 16; n++) sand.step(0, 10);
  assert.ok(sand.y[0] > sourceY, 'vacancy 30 cells away must wake source without external wakeAll');
  conserved(sand);
});

test('a small force wakes a zero-g sleeper while another grain keeps moving', () => {
  const sand = new Sand(2);
  sand.grid.fill(0);
  for (let i = 0; i < sand.count; i++) {
    const cell = sand.index(i ? 40 : -40, 160);
    sand.cell[i] = cell;
    sand.grid[cell] = i + 1;
    sand.x[i] = sand.worldX(cell % COLS);
    sand.y[i] = sand.worldY(Math.floor(cell / COLS));
  }
  sand.vx[1] = 1;
  const initialX = sand.x[0];
  sand.step(0, 0);
  for (let n = 0; n < 120; n++) sand.step(1, 0);
  assert.ok(sand.x[0] > initialX, 'small nonzero force must move the former sleeper');
  assert.ok(sand.vx[0] > 1, 'former sleeper must accumulate acceleration');
  conserved(sand);
});

test('a small force change across plate friction releases a stopped grain', () => {
  const sand = new Sand(2);
  sand.grid.fill(0);
  for (let i = 0; i < sand.count; i++) {
    const cell = sand.index(i ? 40 : -40, 160);
    sand.cell[i] = cell;
    sand.grid[cell] = i + 1;
    sand.x[i] = sand.worldX(cell % COLS);
    sand.y[i] = sand.worldY(Math.floor(cell / COLS));
  }
  sand.vx[1] = 100;
  const initialX = sand.x[0];
  for (let n = 0; n < 10; n++) sand.step(293.8, 0, 650);
  assert.equal(sand.x[0], initialX, 'static plate friction must hold the first grain');
  for (let n = 0; n < 30; n++) sand.step(294.8, 0, 650);
  assert.ok(sand.x[0] > initialX, 'crossing the static threshold must release the grain');
  assert.ok(sand.vx[0] > 0);
  conserved(sand);
});
