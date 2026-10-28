import test from 'node:test';
import assert from 'node:assert/strict';
import { Sand, DT, COUNT, RADIUS, halfWidth } from '../src/physics.js';
import { surfaceAngles } from '../scripts/benchmark.js';
function contained(sand) {
  for(let i=0;i<sand.count;i++) {
    assert.ok(Number.isFinite(sand.x[i]) && Number.isFinite(sand.y[i]));
    assert.ok(Math.abs(sand.y[i])<=220.1, `grain ${i} escaped vertically`);
    assert.ok(Math.abs(sand.x[i])<=halfWidth(sand.y[i])+.1, `grain ${i} escaped sideways`);
  }
}
function advance(sand, seconds, gx=0, gy=650) {
  for(let n=0;n<Math.round(seconds/DT);n++) { sand.step(gx,gy); if(n%480===0) contained(sand); }
  contained(sand);
}
test('natural drainage, a frictional pile, and reversal conserve all grains', () => {
  const sand = new Sand(); const initial=sand.snapshot();
  advance(sand,5); const upper=Array.from(sand.y).filter(y=>y<0).length;
  assert.ok(upper>0 && upper<COUNT-100,'sand must drain gradually through the neck');
  advance(sand,30);
  assert.equal(Array.from(sand.y).filter(y=>y<0).length,0,'no permanent neck blockage');
  const angles=surfaceAngles(sand);
  console.log('Measured natural-pile surface angles:',angles);
  for(const a of angles) assert.ok(a>25 && a<43,`unexpected repose angle ${a}`);
  let overlap=0;
  for(let i=0;i<COUNT;i++)for(let j=0;j<i;j++) overlap=Math.max(overlap,1-Math.hypot(sand.x[i]-sand.x[j],sand.y[i]-sand.y[j])/(RADIUS*2));
  assert.ok(overlap<.25,`excessive grain compression ${overlap}`);
  advance(sand,20,0,-650);
  assert.equal(Array.from(sand.y).filter(y=>y>0).length,0,'all sand must flow back after inversion');
  advance(sand,3,650,0); advance(sand,3,-650,0); advance(sand,2,1800,1400);
  assert.equal(sand.snapshot().length,COUNT*2);
  sand.reset(); assert.deepEqual(sand.snapshot(),initial);
  assert.throws(()=>sand.step(NaN,0)); assert.throws(()=>sand.step(0,10000));
});
