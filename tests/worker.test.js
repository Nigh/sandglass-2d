import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DT } from '../src/geometry.js';

test('a slow physics step cannot turn catch-up into a long batch that starves updates', () => {
  let now = 0,
    callback,
    steps = 0;
  const messages = [];
  // Run the real Worker scheduler with a deterministic 25 ms physics step.
  class SlowSand {
    count = 1;
    tick = 0;
    vx = [0];
    vy = [0];
    step() {
      now += 25;
      steps++;
      this.tick++;
    }
    snapshot() {
      return new Float32Array(2);
    }
  }
  const self = {
    postMessage(message) {
      messages.push({ at: now, ...message });
    }
  };
  const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8').replace(
    /^import .*\n/,
    ''
  );
  runInNewContext(source, {
    Sand: SlowSand,
    DT,
    self,
    performance: { now: () => now },
    setInterval(fn) {
      callback = fn;
    },
    Float32Array
  });
  now = 1000;
  callback();
  assert.equal(steps, 1, 'slow device must yield after one expensive step');
  for (let i = 0; i < 50; i++) {
    now += 8;
    const before = steps;
    callback();
    assert.ok(steps - before <= 1);
  }
  assert.ok(messages.length >= 25, 'worker must keep publishing new states while behind');
  for (let i = 1; i < messages.length; i++) assert.ok(messages[i].at - messages[i - 1].at <= 36);
  self.onmessage({ data: { type: 'pause', value: true } });
  const before = steps;
  now += 2500;
  callback();
  assert.equal(steps, before);
});
