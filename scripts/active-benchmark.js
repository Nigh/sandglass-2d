import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Sand, DT, COUNT, RADIUS, halfWidth } from '../src/physics.js';

const CELL = 2 * RADIUS;
const COLS = Math.ceil(224 / CELL);
const STEPS = 120;
const ROUNDS = 3;
const GRAVITY = [0, 650, 0];
const SEED = 123456789;
const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  assert(['--baseline', '--output'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'),
    'Usage: node scripts/active-benchmark.js [--baseline path] [--output path]');
  assert(!options[args[i]], `Duplicate option: ${args[i]}`);
  options[args[i]] = args[i + 1];
}
let Baseline = null;
if (options['--baseline']) {
  const source = await readFile(options['--baseline'], 'utf8');
  const geometry = JSON.stringify(new URL('../src/geometry.js', import.meta.url).href);
  const rewritten = source.replaceAll("'./geometry.js'", geometry).replaceAll('"./geometry.js"', geometry);
  ({ Sand: Baseline } = await import(`data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`));
}
const implementations = Baseline ? [['baseline', Baseline], ['current', Sand]] : [['current', Sand]];

function wake(sand) {
  if (sand.wakeAll) sand.wakeAll();
  else {
    sand.sleeping = false;
    sand.gx = sand.gy = NaN;
  }
}

function make(Type, cells, valid, airborne = -1, dense = false) {
  const sand = new Type(cells.length);
  sand.valid.set(valid);
  sand.grid.fill(0);
  for (const name of ['vx', 'vy', 'carryX', 'carryY', 'travel']) sand[name].fill(0);
  sand.throatBudget.fill(4);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    sand.cell[i] = cell;
    sand.grid[cell] = i + 1;
    sand.x[i] = sand.worldX(cell % COLS);
    sand.y[i] = sand.worldY(Math.floor(cell / COLS));
    sand.order[i] = i;
  }
  sand.random = SEED;
  sand.tick = 0;
  wake(sand);
  sand.resting.fill(dense ? 0 : 1);
  if (airborne >= 0) {
    sand.resting[airborne] = 0;
    sand.vx[airborne] = 12;
    sand.vy[airborne] = 24;
  }
  return sand;
}

function invariants(sand) {
  let occupied = 0;
  for (let cell = 0; cell < sand.grid.length; cell++) {
    const owner = sand.grid[cell];
    if (!owner) continue;
    occupied++;
    assert(owner > 0 && owner <= sand.count && sand.valid[cell], 'Invalid occupied cell');
    assert.equal(sand.cell[owner - 1], cell, 'Grid ownership mismatch');
  }
  assert.equal(occupied, sand.count, 'Particle count changed');
  for (let i = 0; i < sand.count; i++) {
    const cell = sand.cell[i];
    assert.equal(sand.grid[cell], i + 1, 'Duplicate or missing cell');
    assert(sand.valid[cell], 'Grain left valid geometry');
    assert(Number.isFinite(sand.vx[i]) && Number.isFinite(sand.vy[i]), 'Nonfinite velocity');
    assert.equal(sand.x[i], sand.worldX(cell % COLS));
    assert.equal(sand.y[i], sand.worldY(Math.floor(cell / COLS)));
    assert(Math.abs(sand.y[i]) < 220 && Math.abs(sand.x[i]) < halfWidth(sand.y[i]), 'Grain escaped vessel');
  }
}

function supported(sand) {
  const grounded = new Uint8Array(sand.count);
  const queue = new Int32Array(sand.count);
  let tail = 0;
  for (let i = 0; i < sand.count; i++) {
    if (!sand.valid[sand.cell[i] + COLS]) {
      grounded[i] = 1;
      queue[tail++] = i;
    }
  }
  for (let q = 0; q < tail; q++) {
    for (const offset of [-1, 1, -COLS, COLS]) {
      const id = sand.grid[sand.cell[queue[q]] + offset] - 1;
      if (id >= 0 && !grounded[id]) {
        grounded[id] = 1;
        queue[tail++] = id;
      }
    }
  }
  return grounded;
}

const warmStarted = performance.now();
const bed = new (Baseline || Sand)(COUNT);
let warmSteps = 0;
while (!bed.sleeping && warmSteps < Math.ceil(180 / DT)) {
  bed.step(...GRAVITY);
  warmSteps++;
}
assert(bed.sleeping, 'Common bed did not settle within 180 simulated seconds');
invariants(bed);
const warmMs = performance.now() - warmStarted;
const heights = Array.from(bed.y).sort((a, b) => a - b);
const targetY = heights[Math.floor(heights.length * 0.35)];
let center = 0, distance = Infinity;
for (let i = 0; i < bed.count; i++) {
  const next = Math.hypot(bed.x[i], bed.y[i] - targetY);
  if (next < distance) { distance = next; center = i; }
}
const centerX = bed.x[center], centerY = bed.y[center];
assert(centerY > 0, 'Cavities must be inside lower bed');
const shapes = [
  ['intact', () => false],
  ['circle', (x, y) => Math.hypot(x - centerX, y - centerY) < 9],
  ['horizontal-slit', (_x, y) => Math.abs(y - centerY) < 2 * CELL],
  ['vertical-slot', (x, y) => Math.abs(x - centerX) < 2 * CELL && Math.abs(y - centerY) < 20],
  ['diagonal-cut', (x, y) => Math.abs(x - centerX) < 35 && Math.abs(y - centerY - 0.6 * (x - centerX)) < 2 * CELL],
  ['tiny-hole', (x, y) => Math.hypot(x - centerX, y - centerY) < CELL * 1.1]
];
const fixtures = shapes.map(([name, remove]) => {
  const cells = [], removed = [];
  for (let i = 0; i < bed.count; i++) {
    (remove(bed.x[i], bed.y[i]) ? removed : cells).push(bed.cell[i]);
  }
  if (name !== 'intact') assert(removed.length > 0, `${name}: cavity must remove grains`);
  return { name, cells, removed, create: Type => make(Type, cells, bed.valid), gravity: () => GRAVITY };
});
let top = 0;
for (let i = 1; i < bed.count; i++) if (bed.y[i] < bed.y[top]) top = i;
const airborneCells = Array.from(bed.cell);
const airborneCell = bed.index(0, Math.max(15, bed.y[top] - 70));
assert(bed.valid[airborneCell] && !bed.grid[airborneCell], 'Airborne fixture needs free space above bed');
airborneCells[top] = airborneCell;
fixtures.push({
  name: 'one-airborne', cells: airborneCells, removed: [], airborne: top,
  create: Type => make(Type, airborneCells, bed.valid, top), gravity: () => GRAVITY
});
const denseCells = [];
for (let y = 235; y < 295; y++)
  for (let x = 66; x < 106; x++) {
    const cell = y * COLS + x;
    assert(bed.valid[cell], 'Dense fixture must fit original geometry');
    denseCells.push(cell);
  }
fixtures.push({
  name: 'dense-inversion-pulse', cells: denseCells, removed: [], dense: true,
  create: Type => make(Type, denseCells, bed.valid, -1, true),
  gravity: step => step < 30 ? [0, -650, 0]
    : step < 60 ? [Math.sin(step * 0.2) * 1200, 650, 0]
      : step < 66 ? [3120, 4160, 0] : [0, step < 90 ? -650 : 650, 0]
});

function activeCall(sand, gravity) {
  return !sand.sleeping || !Number.isFinite(sand.gx)
    || Math.hypot(gravity[0] - sand.gx, gravity[1] - sand.gy, gravity[2] - (sand.normal || 0)) > 2;
}

function behavior(fixture, Type) {
  const sand = fixture.create(Type);
  const initial = sand.cell.slice(), initialY = sand.y.slice(), previous = sand.cell.slice();
  const moved = new Uint8Array(sand.count), updated = [];
  const grounded = fixture.dense ? null : supported(sand);
  const remote = [];
  if (fixture.name === 'horizontal-slit') {
    for (let i = 0; i < sand.count; i++)
      if (!grounded[i] && sand.y[i] < centerY - 16 * CELL) remote.push(i);
    assert(remote.length > 0, 'Slit must detach mass more than one activity block away');
  }
  let movedGrainSteps = 0, activeSteps = 0, referenceV = 0;
  for (let step = 0; step < STEPS; step++) {
    const gravity = fixture.gravity(step);
    const awake = activeCall(sand, gravity);
    sand.step(...gravity);
    activeSteps += Number(awake);
    updated.push(sand.lastUpdatedCount ?? (awake ? sand.count : 0));
    invariants(sand);
    if (fixture.dense && step < 8) {
      referenceV = (referenceV - 650 * DT) / (1 + 0.35 * DT);
      let minimum = Infinity, maximum = -Infinity;
      for (let i = 0; i < sand.count; i++) {
        assert(Math.abs(sand.vy[i] - referenceV) < 1e-8, 'Airborne dense mass lost coherent velocity');
        minimum = Math.min(minimum, sand.y[i] - initialY[i]);
        maximum = Math.max(maximum, sand.y[i] - initialY[i]);
      }
      assert(maximum - minimum < CELL * 1.01, 'Airborne mass split into layers');
    }
    for (let i = 0; i < sand.count; i++) {
      if (sand.cell[i] !== previous[i]) { moved[i] = 1; movedGrainSteps++; }
      previous[i] = sand.cell[i];
    }
  }
  let displaced = 0;
  for (let i = 0; i < sand.count; i++) displaced += Number(sand.cell[i] !== initial[i]);
  const refill = fixture.removed.reduce((sum, cell) => sum + Number(sand.grid[cell] > 0), 0);
  const remoteFallen = remote.filter(i => sand.y[i] > initialY[i] + CELL * 0.5).length;
  const movedGrains = moved.reduce((sum, value) => sum + value, 0);
  if (fixture.name === 'intact') {
    assert.equal(movedGrains, 0, 'Intact settled bed must not creep');
    assert(sand.sleeping, 'Intact bed must sleep');
  } else if (fixture.removed.length) {
    assert(movedGrains > 0, `${fixture.name}: cavity did not trigger motion`);
    assert(refill >= fixture.removed.length * 0.5, `${fixture.name}: cavity must mostly close within two seconds`);
  }
  if (remote.length) assert(remoteFallen >= remote.length * 0.5, 'Remote unsupported mass must fall across activity blocks');
  if (fixture.name === 'one-airborne') assert(moved[fixture.airborne], 'Airborne grain must move');
  return {
    count: sand.count, removed: fixture.removed.length, movedGrains, movedGrainSteps, displacedGrains: displaced,
    cavityFilled: refill, cavityRefillFraction: fixture.removed.length ? refill / fixture.removed.length : null,
    detachedBeforeStep: grounded ? sand.count - grounded.reduce((sum, n) => sum + n, 0) : null,
    remoteUnsupported: remote.length, remoteFallen, sleeping: sand.sleeping,
    uniqueCells: sand.count, escaped: 0, activeSteps, updatedParticles: updated,
    totalUpdatedParticles: updated.reduce((sum, n) => sum + n, 0),
    minimumAwakeUpdatedParticles: Math.min(...updated.filter(n => n > 0)),
    finalActiveCount: sand.activeCount ?? (sand.sleeping ? 0 : sand.count),
    coherentInitialAirborneVelocity: fixture.dense ? true : undefined
  };
}

function time(fixture, Type) {
  const sand = fixture.create(Type);
  let activeMs = 0, subsequentMs = 0, sparseMs = 0, coldMs = null;
  let activeSteps = 0, sparseSteps = 0, updatedParticles = 0;
  for (let step = 0; step < STEPS; step++) {
    const gravity = fixture.gravity(step);
    const awake = activeCall(sand, gravity);
    const started = awake ? performance.now() : 0;
    sand.step(...gravity);
    const elapsed = awake ? performance.now() - started : 0;
    const updated = sand.lastUpdatedCount ?? (awake ? sand.count : 0);
    updatedParticles += updated;
    if (!awake) continue;
    if (coldMs === null) coldMs = elapsed;
    else subsequentMs += elapsed;
    activeMs += elapsed;
    activeSteps++;
    if (updated > 0 && updated < sand.count / 4) { sparseMs += elapsed; sparseSteps++; }
  }
  return {
    activeStepMs: activeSteps ? activeMs / activeSteps : null,
    firstWakeMs: coldMs,
    subsequentActiveStepMs: activeSteps > 1 ? subsequentMs / (activeSteps - 1) : null,
    sparseStepMs: sparseSteps ? sparseMs / sparseSteps : null,
    activeTotalMs: activeMs, activeSteps, sparseSteps, updatedParticles
  };
}

const median = values => {
  const finite = values.filter(value => value !== null).sort((a, b) => a - b);
  return finite.length ? finite[Math.floor(finite.length / 2)] : null;
};
const results = [];
for (const fixture of fixtures) {
  const observations = {};
  for (const [name, Type] of implementations) observations[name] = behavior(fixture, Type);
  if (Baseline && fixture.removed.length) {
    assert(observations.current.cavityRefillFraction >= observations.baseline.cavityRefillFraction * 0.5,
      `${fixture.name}: current refill fell outside broad baseline bound`);
    assert(observations.current.movedGrains >= Math.max(1, observations.baseline.movedGrains * 0.1),
      `${fixture.name}: current reaction fell outside broad baseline bound`);
  }
  const rounds = Object.fromEntries(implementations.map(([name]) => [name, []]));
  for (let round = 0; round < ROUNDS; round++) {
    const order = round % 2 ? [...implementations].reverse() : implementations;
    for (const [name, Type] of order) rounds[name].push(time(fixture, Type));
  }
  const timing = {};
  for (const [name] of implementations) {
    timing[name] = Object.fromEntries(['activeStepMs', 'firstWakeMs', 'subsequentActiveStepMs', 'sparseStepMs', 'activeTotalMs']
      .map(key => [key, median(rounds[name].map(run => run[key]))]));
    timing[name].runs = rounds[name];
  }
  if (Baseline) {
    timing.activeStepSpeedup = timing.baseline.activeStepMs / timing.current.activeStepMs;
    timing.subsequentActiveStepSpeedup = timing.baseline.subsequentActiveStepMs / timing.current.subsequentActiveStepMs;
    timing.activeTotalSpeedup = timing.baseline.activeTotalMs / timing.current.activeTotalMs;
  }
  results.push({ fixture: fixture.name, observations, timing });
}
const report = {
  metadata: {
    node: process.version, v8: process.versions.v8, cpu: os.cpus()[0]?.model,
    platform: process.platform, arch: process.arch, logicalCPUs: os.cpus().length,
    seed: SEED, steps: STEPS, simulatedSeconds: STEPS * DT, rounds: ROUNDS,
    baseline: options['--baseline'] ? resolve(options['--baseline']) : null,
    commonBedSource: Baseline ? 'provided baseline' : 'current production solver',
    timing: 'Median of three alternating runs. Only step() is timed; construction, assertions, support oracle, fixture scans and sleep calls excluded. First wake is separate from subsequent active calls. Sparse calls predict fewer than one quarter of all grains. Dense control is measured, not assumed regression-free.',
    comparison: 'Identical initial cells and deterministic state. Consumer-visible conservation, geometry, stable rest, majority cavity closure and remote fall are asserted; RNG trajectories need not match.'
  },
  warmup: { steps: warmSteps, simulatedSeconds: warmSteps * DT, wallMs: warmMs, sleeping: bed.sleeping },
  excavationCenter: { x: centerX, y: centerY },
  results
};
const json = JSON.stringify(report, null, 2) + '\n';
if (options['--output']) await writeFile(options['--output'], json);
process.stdout.write(json);
