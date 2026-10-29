import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sand, DT, COUNT, RADIUS, halfWidth, initPhysics } from '../src/physics.js';
await initPhysics(readFileSync(new URL('../src/sand.wasm',import.meta.url)));
function contained(sand){
  assert.equal(sand.x.length,sand.count);
  for(let i=0;i<sand.count;i++){
    assert.ok(Number.isFinite(sand.x[i])&&Number.isFinite(sand.y[i]));
    assert.ok(Math.abs(sand.y[i])<220.01&&Math.abs(sand.x[i])<halfWidth(sand.y[i])+.01,`grain ${i} escaped`);
  }
}
function advance(sand,seconds,gx=0,gy=650){
  for(let n=0;n<Math.round(seconds/DT);n++){sand.step(gx,gy);if(n%120===0)contained(sand);}
  contained(sand);
}
function mean(array){return array.reduce((sum,v)=>sum+v,0)/array.length;}
test('both sides of the neck converge, rather than leaving a stationary central tunnel',()=>{
  const sand=new Sand(),initial=sand.x.slice(),sides=[[],[]];
  for(let i=0;i<sand.count;i++)if(sand.y[i]>-65&&sand.y[i]<-12&&Math.abs(sand.x[i])>halfWidth(sand.y[i])*.3)sides[sand.x[i]<0?0:1].push(i);
  advance(sand,8);
  const result=sides.map((ids,side)=>{
    assert.ok(ids.length>300);
    const fed=ids.filter(i=>sand.y[i]>0||(sand.x[i]-initial[i])*(side?-1:1)>RADIUS).length;
    assert.ok(fed/ids.length>.8,`side ${side} did not feed: ${fed}/${ids.length}`);
    return fed/ids.length;
  });
  console.log('Near-neck side feeding fractions:',result);
  const drained=COUNT-Array.from(sand.y).filter(y=>y<0).length;
  assert.ok(drained>50&&drained<COUNT,'the neck must produce a continuing stream');
});
test('uneven airborne sand conserves momentum and falls as a whole through twelve reversals',()=>{
  const sand=new Sand(160),reference=new Sand(1);
  for(let i=0;i<sand.count;i++){
    sand.x[i]=(i%8)*RADIUS*2.06+(Math.floor(i/8)%2)*RADIUS-5;
    sand.y[i]=100+Math.floor(i/8)*RADIUS*1.79;
    sand.vx[i]=(i%5-2)*2;sand.vy[i]=(i%7-3)*1.5;
  }
  reference.x[0]=mean(sand.x);reference.y[0]=mean(sand.y);
  reference.vx[0]=mean(sand.vx);reference.vy[0]=mean(sand.vy);
  for(let flip=0;flip<12;flip++){
    const gy=flip%2?650:-650;
    for(let n=0;n<Math.round(.15/DT);n++){
      sand.step(0,gy);reference.step(0,gy);
      assert.ok(Math.abs(mean(sand.vx)-reference.vx[0])<1e-7,'internal contacts must not erase bulk momentum');
      assert.ok(Math.abs(mean(sand.vy)-reference.vy[0])<1e-7,'falling neighbours must not become fixed supports');
      assert.ok(Math.abs(mean(sand.y)-reference.y[0])<1e-6,'bulk free-fall must not peel off layer by layer');
    }
    contained(sand);
  }
});
test('settled sand stays still and resumes after repeated full inversions and shaking',()=>{
  const sand=new Sand(2400),initial=sand.snapshot();
  for(let cycle=0;cycle<3;cycle++){
    const gy=cycle%2?-650:650;
    advance(sand,90,0,gy);
    assert.equal(Array.from(sand.y).filter(y=>y*gy<0).length,0,'all sand should cross the neck');
    assert.ok(sand.sleeping,'settled material must enter rest');
    const still=sand.snapshot();advance(sand,3,0,gy);assert.deepEqual(sand.snapshot(),still,'position repair must not create bouncing');
    for(let n=0;n<60;n++)sand.step(Math.sin(n*.16)*1400,gy+Math.cos(n*.16)*700);
    assert.notDeepEqual(sand.snapshot(),still,'shaking must wake and move the bed');
    contained(sand);
  }
  advance(sand,2,650,0);advance(sand,2,-650,0);advance(sand,2,1800,1400);
  sand.reset();assert.deepEqual(sand.snapshot(),initial);
  assert.throws(()=>sand.step(NaN,0));assert.throws(()=>sand.step(0,10000));
});
test('an acceleration pulse leaves real airborne inertia',()=>{
  const sand=new Sand(1);sand.x[0]=0;sand.y[0]=80;
  advance(sand,.1,1300,650);
  const x=sand.x[0],vx=sand.vx[0];assert.ok(vx>100);
  sand.step(0,650);assert.ok(sand.x[0]>x&&sand.vx[0]>vx*.98);
});

test('a flat shallow vessel stops motion through plate friction, while true zero-g keeps inertia',()=>{
  const flat=new Sand(1),free=new Sand(1);
  flat.x[0]=free.x[0]=-40;flat.y[0]=free.y[0]=160;flat.vx[0]=free.vx[0]=100;
  for(let n=0;n<1/DT;n++){flat.step(0,0,650);free.step(0,0,0);}
  assert.ok(Math.abs(flat.vx[0])<1e-8,'front/back plates must dissipate flat-phone motion');
  assert.ok(free.vx[0]>60,'zero specific force must not invent plate pressure');
  const still=flat.snapshot();for(let n=0;n<30;n++)flat.step(60,0,650);
  assert.deepEqual(flat.snapshot(),still,'static plate friction must hold small tilts');
  for(let n=0;n<30;n++)flat.step(500,0,400);
  assert.ok(flat.vx[0]>10,'tilting past friction or shaking must release the sand');
  assert.throws(()=>flat.step(0,0,-1));assert.throws(()=>flat.step(0,0,NaN));
});
