import test from 'node:test';
import assert from 'node:assert/strict';
import { Sand, DT, COUNT, RADIUS, PROFILE, halfWidth } from '../src/physics.js';
import { surfaceAngles } from '../scripts/benchmark.js';
function contained(sand) {
  let occupied=0;
  for(const id of sand.grid) occupied+=id>0;
  assert.equal(occupied,sand.count,'each grain must have exactly one occupied cell');
  for(let i=0;i<sand.count;i++) {
    assert.ok(Number.isFinite(sand.x[i]) && Number.isFinite(sand.y[i]));
    assert.ok(Math.abs(sand.y[i])<220 && Math.abs(sand.x[i])<halfWidth(sand.y[i]));
    assert.equal(sand.grid[sand.cell[i]],i+1,'grid and particle state must agree');
    assert.equal(sand.index(sand.x[i],sand.y[i]),sand.cell[i]);
  }
}
function advance(sand,seconds,gx=0,gy=650) {
  for(let n=0;n<Math.round(seconds/DT);n++) {sand.step(gx,gy);if(n%120===0) contained(sand);}
  contained(sand);
}
test('fine sand, narrow slow stream, stable resting pile, shaking and inversion',()=>{
  assert.ok(RADIUS<.7);assert.ok(PROFILE[4][1]*2<6);
  const full=new Sand();advance(full,10);
  const drained=COUNT-Array.from(full.y).filter(y=>y<0).length;
  assert.ok(drained>50 && drained<COUNT*.15,'a thin stream should drain slowly, not empty in seconds');
  const sand=new Sand(2400), initial=sand.snapshot();
  advance(sand,150);
  assert.equal(Array.from(sand.y).filter(y=>y<0).length,0);
  const angles=surfaceAngles(sand);console.log('Resting pile angles:',angles);
  for(const angle of angles) assert.ok(angle>27 && angle<39,`unexpected surface angle ${angle}`);
  assert.ok(sand.sleeping,'a fully settled bed must stop computing');
  const still=sand.snapshot();advance(sand,5);assert.deepEqual(sand.snapshot(),still,'resting grains must not oscillate');
  for(let n=0;n<120;n++) sand.step(Math.sin(n*.16)*1800,650+Math.cos(n*.16)*1000);
  contained(sand);assert.notDeepEqual(sand.snapshot(),still,'a shake must wake and move the sand');
  advance(sand,150,0,-650);
  assert.equal(Array.from(sand.y).filter(y=>y>0).length,0,'sand should flow back after inversion');
  advance(sand,3,650,0);advance(sand,3,-650,0);advance(sand,2,1800,1400);
  sand.reset();assert.deepEqual(sand.snapshot(),initial);
  assert.throws(()=>sand.step(NaN,0));assert.throws(()=>sand.step(0,10000));
});
test('airborne grains keep momentum after a short acceleration pulse',()=>{
  const sand=new Sand(1);sand.grid.fill(0);sand.x[0]=0;sand.y[0]=80;
  sand.cell[0]=sand.index(0,80);sand.grid[sand.cell[0]]=1;
  advance(sand,.1,1300,650);
  const x=sand.x[0],vx=sand.vx[0];assert.ok(vx>100);
  sand.step(0,650);assert.ok(sand.x[0]>x && sand.vx[0]>vx*.98,'releasing the shake must not erase inertia');
  sand.sleeping=true;sand.gx=0;sand.gy=650;
  for(let n=1;n<=4;n++) sand.step(n,650);
  assert.ok(!sand.sleeping,'small cumulative changes in tilt must wake the bed');
});
