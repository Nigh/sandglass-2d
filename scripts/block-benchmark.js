import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { Sand, DT, COUNT, RADIUS } from '../src/physics.js';
import { FixedBlockSupport } from './fixed-block-support.js';

const CELL = RADIUS * 2;
const COLS = Math.ceil(224 / CELL);
const ROWS = Math.ceil(444 / CELL);
const STEPS = 120;
const ROUNDS = 3;
const BLOCK_SIZES = [8, 16, 32];
const GRAVITY = [0, 650, 0];
const offsets = [-1, 1, -COLS, COLS];

// Only this in-memory module changes. Production Sand remains the reference.
const source = await readFile(new URL('../src/physics.js', import.meta.url), 'utf8');
const supportStart = '    this.grounded.fill(0);';
const supportEnd = '    let moving = false;';
const moveMarker = '      this.grid[old] = 0;';
function uniquePosition(text, marker) {
  const position = text.indexOf(marker);
  assert(position >= 0 && position === text.lastIndexOf(marker), `Expected unique instrumentation marker: ${marker}`);
  return position;
}
const start = uniquePosition(source, supportStart);
const end = uniquePosition(source, supportEnd);
assert(end > start);
const support = source.slice(start, end);
let experimental = source.slice(0, start) + `    const supportStarted = this.measureSupport ? performance.now() : 0;
    if (this.supportSolver) {
      this.supportSolver.update(this, gx, gy);
    } else {
${support}    }
    if (this.measureSupport) {
      this.supportMs += performance.now() - supportStarted;
      this.supportCalls++;
    }
    this.checkSupport?.(this, gx, gy);
` + source.slice(end);
uniquePosition(experimental, moveMarker);
experimental = experimental.replace(moveMarker,
  '      this.supportSolver?.touch(old);\n      this.supportSolver?.touch(next);\n' + moveMarker);
const geometryURL = new URL('../src/geometry.js', import.meta.url).href;
experimental = experimental.replaceAll("'./geometry.js'", JSON.stringify(geometryURL));
const { Sand: ExperimentalSand } = await import(`data:text/javascript;base64,${Buffer.from(experimental).toString('base64')}`);

function referenceSupport(sand, gx = 0, gy = 650) {
  const grounded = new Uint8Array(sand.count);
  const queue = new Int32Array(sand.count);
  const forward = Math.abs(gx) > Math.abs(gy) ? Math.sign(gx) : Math.sign(gy) * COLS;
  let tail = 0;
  if (Math.hypot(gx, gy) > 0) {
    for (let i = 0; i < sand.count; i++) {
      if (!sand.valid[sand.cell[i] + forward]) {
        grounded[i] = 1;
        queue[tail++] = i;
      }
    }
    for (let q = 0; q < tail; q++) {
      for (const offset of offsets) {
        const id = sand.grid[sand.cell[queue[q]] + offset] - 1;
        if (id >= 0 && !grounded[id]) {
          grounded[id] = 1;
          queue[tail++] = id;
        }
      }
    }
  }
  return grounded;
}

function fixture(bed, remove = () => false, Type = Sand) {
  const survivors = [];
  const removed = [];
  for (let i = 0; i < bed.count; i++) {
    if (remove(bed.x[i], bed.y[i], bed.cell[i])) removed.push(bed.cell[i]);
    else survivors.push(i);
  }
  assert(survivors.length > 0, 'Excavation must retain grains');
  const sand = new Type(survivors.length);
  sand.grid.fill(0);
  sand.valid.set(bed.valid);
  for (let i = 0; i < survivors.length; i++) {
    const old = survivors[i];
    sand.cell[i] = bed.cell[old];
    sand.grid[sand.cell[i]] = i + 1;
    sand.x[i] = bed.x[old];
    sand.y[i] = bed.y[old];
  }
  sand.resting.fill(1);
  sand.sleeping = false;
  sand.gx = sand.gy = NaN;
  return { sand, removed };
}

function invariants(sand) {
  let occupied = 0;
  for (let k = 0; k < sand.grid.length; k++) {
    const owner = sand.grid[k];
    if (!owner) continue;
    occupied++;
    assert(owner > 0 && owner <= sand.count && sand.valid[k], 'Invalid occupied cell');
    assert.equal(sand.cell[owner - 1], k, 'Grid owner disagrees with grain');
  }
  assert.equal(occupied, sand.count, 'Particle count changed');
  for (let i = 0; i < sand.count; i++) {
    assert(sand.valid[sand.cell[i]], 'Grain outside valid vessel');
    assert.equal(sand.grid[sand.cell[i]], i + 1, 'Duplicate or missing ownership');
    assert.equal(sand.x[i], sand.worldX(sand.cell[i] % COLS));
    assert.equal(sand.y[i], sand.worldY(Math.floor(sand.cell[i] / COLS)));
  }
}

function compare(a, b, label) {
  for (const name of ['cell', 'grid', 'grounded', 'x', 'y', 'vx', 'vy', 'carryX', 'carryY', 'travel', 'throatBudget', 'resting', 'order']) {
    assert.deepEqual(a[name], b[name], `${label}: ${name}`);
  }
  assert.equal(a.sleeping, b.sleeping, `${label}: sleeping`);
  assert.equal(a.random, b.random, `${label}: random seed`);
}

function staticDeletion(bed, remove, blockSize) {
  const solver = new FixedBlockSupport(bed, blockSize);
  let started = performance.now();
  solver.update(bed, 0, 650);
  const fullBedColdSupportMs = performance.now() - started;
  const fullBedColdStats = { ...solver.stats };
  assert.deepEqual(bed.grounded, referenceSupport(bed));
  const { sand, removed } = fixture(bed, remove);
  started = performance.now();
  for (const cell of removed) solver.touch(cell);
  solver.update(sand, 0, 650);
  const deletionSupportMs = performance.now() - started;
  const deletionStats = { ...solver.stats };
  assert.deepEqual(sand.grounded, referenceSupport(sand), 'Cached deletion differs from BFS');
  const detached = sand.count - sand.grounded.reduce((sum, value) => sum + value, 0);
  for (const [gx, gy] of [[650, 0], [-650, 0], [0, -650], [0, 0], [0, 650]]) {
    solver.update(sand, gx, gy);
    assert.deepEqual(sand.grounded, referenceSupport(sand, gx, gy), 'Changed gravity differs from BFS');
  }
  return { detached, fullBedColdSupportMs, fullBedColdStats, deletionSupportMs, deletionStats };
}

function synthetic(cycle) {
  const cells = new Set();
  const column = cycle ? 80 : 10;
  const top = cycle ? 100 : 80;
  const bridgeRow = cycle ? 101 : 140;
  for (let y = top; y <= ROWS - 3; y++) cells.add(y * COLS + column);
  if (cycle) {
    for (let x = 40; x <= 120; x++) {
      cells.add(80 * COLS + x);
      cells.add(100 * COLS + x);
    }
    for (let y = 80; y <= 100; y++) {
      cells.add(y * COLS + 40);
      cells.add(y * COLS + 120);
    }
  } else {
    for (let x = column; x <= 140; x++) cells.add(top * COLS + x);
  }
  const sand = new Sand(cells.size);
  sand.valid.fill(0);
  for (let y = 2; y <= ROWS - 3; y++) {
    for (let x = 2; x <= COLS - 3; x++) sand.valid[y * COLS + x] = 1;
  }
  sand.grid.fill(0);
  let i = 0;
  for (const cell of cells) {
    sand.cell[i] = cell;
    sand.grid[cell] = i + 1;
    sand.x[i] = sand.worldX(cell % COLS);
    sand.y[i] = sand.worldY(Math.floor(cell / COLS));
    i++;
  }
  const bridge = bridgeRow * COLS + column;
  const island = (cycle ? 80 : top) * COLS + 120;
  for (const blockSize of BLOCK_SIZES) {
    const solver = new FixedBlockSupport(sand, blockSize);
    solver.update(sand, 0, 650);
    assert(sand.grounded.every(Boolean), 'Synthetic structure starts supported');
    const cut = fixture(sand, (_x, _y, k) => k === bridge).sand;
    solver.touch(bridge);
    solver.update(cut, 0, 650);
    const expected = referenceSupport(cut);
    const islandId = cut.grid[island] - 1;
    assert(islandId >= 0);
    assert.equal(expected[islandId], 0, 'BFS must detach distant island');
    assert.equal(cut.grounded[islandId], 0, 'Block solver must detach distant island');
    assert.deepEqual(cut.grounded, expected);
    invariants(cut);
  }
}

const warmStart = performance.now();
const bed = new Sand(COUNT);
let warmSteps = 0;
while (!bed.sleeping && warmSteps < Math.ceil(180 / DT)) {
  bed.step(...GRAVITY);
  warmSteps++;
}
assert(bed.sleeping, '10000-grain bed did not sleep within 180 simulated seconds');
invariants(bed);
const warmMs = performance.now() - warmStart;
const heights = Array.from(bed.y).sort((a, b) => a - b);
const centerY = heights[Math.floor(heights.length * 0.35)];
assert(centerY > 0, 'Excavations must be in lower pile');
let centerId = 0;
let distance = Infinity;
for (let i = 0; i < bed.count; i++) {
  const next = Math.hypot(bed.x[i], bed.y[i] - centerY);
  if (next < distance) { distance = next; centerId = i; }
}
const centerX = bed.x[centerId];
const holeY = bed.y[centerId];
const shapes = [
  ['intact', () => false],
  ['circle', (x, y) => Math.hypot(x - centerX, y - holeY) < 9],
  ['horizontal-slit', (_x, y) => Math.abs(y - holeY) < 2 * CELL],
  ['vertical-slot', (x, y) => Math.abs(x - centerX) < 2 * CELL && Math.abs(y - holeY) < 20],
  ['diagonal-cut', (x, y) => Math.abs(x - centerX) < 35 && Math.abs(y - holeY - 0.6 * (x - centerX)) < 2 * CELL],
  ['tiny-hole', (x, y) => Math.hypot(x - centerX, y - holeY) < CELL * 1.1]
];
synthetic(false);
synthetic(true);

function median(values) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

function timeSteps(remove, blockSize, candidate) {
  const { sand } = fixture(bed, remove, ExperimentalSand);
  if (candidate) sand.supportSolver = new FixedBlockSupport(sand, blockSize);
  sand.measureSupport = true;
  sand.supportMs = 0;
  sand.supportCalls = 0;
  let activeMs = 0;
  const started = performance.now();
  for (let step = 0; step < STEPS; step++) {
    const calls = sand.supportCalls;
    const stepStarted = performance.now();
    sand.step(...GRAVITY);
    if (sand.supportCalls !== calls) activeMs += performance.now() - stepStarted;
  }
  return {
    wholeStepMs: (performance.now() - started) / STEPS,
    activeStepMs: activeMs / (sand.supportCalls || 1),
    supportMsPerStep: sand.supportMs / STEPS,
    supportMsPerCall: sand.supportMs / (sand.supportCalls || 1),
    supportCalls: sand.supportCalls,
    sleeping: sand.sleeping
  };
}

function queryTiming(remove, blockSize, candidate) {
  const { sand } = fixture(bed, remove);
  // Both paths include identical output writes; neither includes oracle/assertions.
  const solver = candidate ? new FixedBlockSupport(sand, blockSize) : null;
  const query = candidate
    ? () => solver.update(sand, 0, 650)
    : () => {
      sand.grounded.fill(0);
      let tail = 0;
      for (let i = 0; i < sand.count; i++) {
        if (!sand.valid[sand.cell[i] + COLS]) {
          sand.grounded[i] = 1;
          sand.queue[tail++] = i;
        }
      }
      for (let q = 0; q < tail; q++) {
        for (const offset of offsets) {
          const id = sand.grid[sand.cell[sand.queue[q]] + offset] - 1;
          if (id >= 0 && !sand.grounded[id]) {
            sand.grounded[id] = 1;
            sand.queue[tail++] = id;
          }
        }
      }
    };
  let started = performance.now();
  query();
  const coldMs = performance.now() - started;
  started = performance.now();
  for (let i = 0; i < STEPS; i++) query();
  return { coldMs, cachedQueryMs: (performance.now() - started) / STEPS, stats: solver ? { ...solver.stats } : undefined };
}

const results = [];
for (const [shape, remove] of shapes) {
  const initial = fixture(bed, remove);
  if (shape !== 'intact') assert(initial.removed.length > 0, `${shape} removes no grains`);
  for (const blockSize of BLOCK_SIZES) {
    const deletion = staticDeletion(bed, remove, blockSize);
    const detachedBeforeStep = deletion.detached;
    if (shape === 'horizontal-slit') assert(detachedBeforeStep > 0, 'Full-width slit must detach upper island');
    const baseline = fixture(bed, remove).sand;
    const candidate = fixture(bed, remove, ExperimentalSand).sand;
    candidate.supportSolver = new FixedBlockSupport(candidate, blockSize);
    let supportChecks = 0;
    let firstStepDetached = null;
    candidate.checkSupport = (sand, gx, gy) => {
      assert.deepEqual(sand.grounded, referenceSupport(sand, gx, gy), `${shape}/${blockSize}: pre-move support`);
      if (firstStepDetached === null) firstStepDetached = sand.count - sand.grounded.reduce((sum, value) => sum + value, 0);
      supportChecks++;
    };
    const originalCells = candidate.cell.slice();
    const moved = new Uint8Array(candidate.count);
    let movedGrainSteps = 0;
    compare(baseline, candidate, 'initial');
    for (let step = 0; step < STEPS; step++) {
      const before = candidate.cell.slice();
      baseline.step(...GRAVITY);
      candidate.step(...GRAVITY);
      compare(baseline, candidate, `${shape}/${blockSize}/step ${step}`);
      invariants(baseline);
      invariants(candidate);
      for (let i = 0; i < candidate.count; i++) {
        if (before[i] !== candidate.cell[i]) { moved[i] = 1; movedGrainSteps++; }
      }
    }
    assert(supportChecks > 0, 'No pre-move support checks ran');
    let displacedGrains = 0;
    for (let i = 0; i < candidate.count; i++) displacedGrains += originalCells[i] !== candidate.cell[i];
    const cavityFilled = initial.removed.reduce((sum, cell) => sum + Number(candidate.grid[cell] > 0), 0);
    const timing = { baseline: [], candidate: [], baselineQuery: [], candidateQuery: [] };
    for (let round = 0; round < ROUNDS; round++) {
      for (const isCandidate of (round % 2 ? [true, false] : [false, true])) {
        const name = isCandidate ? 'candidate' : 'baseline';
        timing[name].push(timeSteps(remove, blockSize, isCandidate));
        timing[`${name}Query`].push(queryTiming(remove, blockSize, isCandidate));
      }
    }
    const summary = {};
    for (const name of ['baseline', 'candidate']) {
      summary[name] = {
        wholeStepMs: median(timing[name].map(value => value.wholeStepMs)),
        activeStepMs: median(timing[name].map(value => value.activeStepMs)),
        supportMsPerStep: median(timing[name].map(value => value.supportMsPerStep)),
        supportMsPerCall: median(timing[name].map(value => value.supportMsPerCall)),
        supportCalls: timing[name].map(value => value.supportCalls),
        coldSupportMs: median(timing[`${name}Query`].map(value => value.coldMs)),
        cachedSupportMs: median(timing[`${name}Query`].map(value => value.cachedQueryMs))
      };
    }
    summary.wholeStepSpeedup = summary.baseline.wholeStepMs / summary.candidate.wholeStepMs;
    results.push({
      shape, blockSize, count: candidate.count, removed: initial.removed.length,
      detachedBeforeStep, firstStepDetached, supportChecks,
      movedGrains: moved.reduce((sum, value) => sum + value, 0), movedGrainSteps,
      displacedGrains, cavityFilled,
      cavityRefillFraction: initial.removed.length ? cavityFilled / initial.removed.length : null,
      sleeping: candidate.sleeping, stats: { ...candidate.supportSolver.stats },
      cachedQueryStats: timing.candidateQuery.at(-1).stats,
      staticDeletion: deletion,
      timing: summary
    });
  }
}

const report = {
  metadata: {
    node: process.version, v8: process.versions.v8, platform: process.platform,
    arch: process.arch, cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length,
    memoryBytes: os.totalmem(), seed: 123456789,
    steps: STEPS, simulatedSeconds: STEPS * DT, rounds: ROUNDS, blockSizes: BLOCK_SIZES,
    gravity: GRAVITY, count: COUNT,
    scope: 'Support replacement only; full particle loops remain, no active-particle list.',
    timing: 'Median of 3 alternating runs; wholeStepMs averages all 120 calls including sleep; activeStepMs averages calls that compute support; both include invalidation and output scans; assertions/oracle excluded; cold support excludes solver construction; cached support uses unchanged awake grid.'
  },
  warmup: { steps: warmSteps, simulatedSeconds: warmSteps * DT, wallMs: warmMs, sleeping: bed.sleeping },
  excavationCenter: { x: centerX, y: holeY },
  synthetic: { singleBridgeDeletion: 'passed', cycleBridgeDeletion: 'passed', blockSizes: BLOCK_SIZES },
  results
};
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--output' && args[1]), 'Usage: node scripts/block-benchmark.js [--output path]');
const json = JSON.stringify(report, null, 2) + '\n';
if (args.length) await writeFile(args[1], json);
process.stdout.write(json);
