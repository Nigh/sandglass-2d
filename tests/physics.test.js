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
test('unsupported packed sand falls together independently of grain IDs and gravity direction',()=>{
  const cases=[[0,-650],[0,650],[650,0],[-650,0],[390,-520],[-390,-520],[390,520],[-390,520],[0,650,80,-120]];
  for(const [gx,gy,vx=0,vy=0] of cases) for(const permutation of [i=>i,i=>159-i,i=>i*37%160]) {
    const sand=new Sand(160),reference=new Sand(1);
    sand.grid.fill(0);reference.grid.fill(0);
    const startX=[],startY=[];
    for(let i=0;i<sand.count;i++) {
      const slot=permutation(i);
      sand.x[i]=sand.worldX(75+slot%8);sand.y[i]=sand.worldY(240+Math.floor(slot/8));
      sand.vx[i]=vx;sand.vy[i]=vy;
      sand.cell[i]=sand.index(sand.x[i],sand.y[i]);sand.grid[sand.cell[i]]=i+1;
      startX.push(sand.x[i]);startY.push(sand.y[i]);
    }
    reference.x[0]=startX[0];reference.y[0]=startY[0];reference.vx[0]=vx;reference.vy[0]=vy;
    reference.cell[0]=reference.index(reference.x[0],reference.y[0]);reference.grid[reference.cell[0]]=1;
    if(gy<0) {sand.sleeping=true;sand.gx=0;sand.gy=650;}
    for(let n=0;n<30;n++) {
      sand.step(gx,gy);reference.step(gx,gy);
      const dx=reference.x[0]-startX[0],dy=reference.y[0]-startY[0];
      for(let i=0;i<sand.count;i++) {
        assert.ok(Math.hypot(sand.x[i]-startX[i]-dx,sand.y[i]-startY[i]-dy)<1e-8,'airborne neighbours must not act as static supports');
        assert.ok(Math.hypot(sand.vx[i]-reference.vx[0],sand.vy[i]-reference.vy[0])<1e-8,'a falling neighbour must not erase momentum');
      }
    }
    contained(sand);
  }
});
test('flipping a settled pile releases its interior together',()=>{
  const sand=new Sand(2400);advance(sand,150);
  assert.ok(sand.sleeping);
  const interior=[];
  for(let i=0;i<sand.count;i++) if(Math.abs(sand.x[i])<10 && sand.y[i]>150) interior.push(i);
  assert.ok(interior.length>200);
  const originalY=sand.y.slice(),originalX=sand.x.slice();
  for(let n=0;n<24;n++) {
    sand.step(0,-650);
    const dy=sand.y[interior[0]]-originalY[interior[0]];
    for(const i of interior) {
      assert.ok(Math.abs(sand.y[i]-originalY[i]-dy)<1e-8,'interior rows must accelerate together after inversion');
      assert.ok(Math.abs(sand.x[i]-originalX[i])<1e-8,'unsupported interior grains must not spuriously avalanche');
    }
  }
  assert.ok(sand.vy[interior[0]] < -120);
  contained(sand);
});
