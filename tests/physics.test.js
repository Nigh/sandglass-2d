import test from 'node:test';
import assert from 'node:assert/strict';
import { Sand, DT, COUNT, RADIUS, halfWidth } from '../src/physics.js';
function contained(sand){
  assert.equal(sand.x.length,sand.count);
  const occupied=new Set(sand.cell);assert.equal(occupied.size,sand.count,'fixed-volume grains must never share a cell');
  for(let i=0;i<sand.count;i++)assert.equal(sand.grid[sand.cell[i]],i+1,'cell ownership must remain consistent');
  for(let i=0;i<sand.count;i++){
    assert.equal(sand.index(sand.x[i],sand.y[i]),sand.cell[i]);
    assert.ok(Math.abs(sand.x[i]-sand.worldX(Math.floor((sand.x[i]+112)/(2*RADIUS))))<1e-7);
    assert.ok(Math.abs(sand.y[i]-sand.worldY(Math.floor((sand.y[i]+222)/(2*RADIUS))))<1e-7);
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
    assert.ok(fed/ids.length>.75,`side ${side} did not feed: ${fed}/${ids.length}`);
    return fed/ids.length;
  });
  console.log('Near-neck side feeding fractions at 8 seconds:',result);
  advance(sand,8);
  for(const [side,ids] of sides.entries())assert.ok(ids.filter(i=>sand.y[i]>0||(sand.x[i]-initial[i])*(side?-1:1)>RADIUS).length/ids.length>.8,'both sides must keep feeding through the narrower neck');
  const drained=COUNT-Array.from(sand.y).filter(y=>y<0).length;
  assert.ok(drained>50&&drained<COUNT,'the neck must produce a continuing stream');
});
function place(sand,points){
  sand.grid.fill(0);sand.resting.fill(0);sand.carryX.fill(0);sand.carryY.fill(0);
  for(let i=0;i<sand.count;i++){
    const k=sand.index(...points[i]);assert.ok(k>=0&&sand.valid[k]&&!sand.grid[k]);
    sand.grid[k]=i+1;sand.cell[i]=k;sand.x[i]=sand.worldX(Math.floor((points[i][0]+112)/(2*RADIUS)));sand.y[i]=sand.worldY(Math.floor((points[i][1]+222)/(2*RADIUS)));
  }
}
test('airborne sand moves together through twelve reversals without losing bulk velocity',()=>{
  const sand=new Sand(160);
  place(sand,Array.from({length:160},(_,i)=>[-5+(i%8)*RADIUS*2,100+Math.floor(i/8)*RADIUS*2]));
  const initial=sand.y.slice();let referenceY=mean(sand.y),referenceV=0;
  for(let flip=0;flip<12;flip++){
    const gy=flip%2?650:-650;
    for(let n=0;n<Math.round(.15/DT);n++){
      referenceV=(referenceV+gy*DT)/(1+.35*DT);referenceY+=referenceV*DT;sand.step(0,gy);
      assert.ok(Math.abs(mean(sand.vy)-referenceV)<1e-7,'moving neighbours must not erase free-fall velocity');
      assert.ok(Math.abs(mean(sand.y)-referenceY)<RADIUS*4,'whole-bed displacement must follow free fall to within two cells');
      const displacement=Array.from(sand.y,(y,i)=>y-initial[i]);
      assert.ok(Math.max(...displacement)-Math.min(...displacement)<RADIUS*2.01,'falling bed must not peel into layers');
    }
    contained(sand);
  }
});
test('a supported bed retains upward shaking inertia and lifts off together',()=>{
  const sand=new Sand(160);
  place(sand,Array.from({length:160},(_,i)=>[-5+(i%8)*RADIUS*2,218-Math.floor(i/8)*RADIUS*2]));
  const initial=sand.y.slice();sand.vy.fill(-100);let velocity=-100;
  for(let n=0;n<8;n++){
    velocity=(velocity+650*DT)/(1+.35*DT);sand.step();
    assert.ok(Math.abs(mean(sand.vy)-velocity)<1e-7,'floor support must not erase a lifting bed’s inertia');
    const displacement=Array.from(sand.y,(y,i)=>y-initial[i]);
    assert.ok(Math.max(...displacement)-Math.min(...displacement)<RADIUS*2.01);
    contained(sand);
  }
  assert.ok(mean(sand.y)<mean(initial)-RADIUS*4);
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
  const sand=new Sand(1);place(sand,[[0,80]]);
  advance(sand,.1,1300,650);
  const x=sand.x[0],vx=sand.vx[0];assert.ok(vx>100);
  advance(sand,.05,0,650);assert.ok(sand.x[0]>x&&sand.vx[0]>vx*.97);
});

test('a flat shallow vessel stops motion through plate friction, while true zero-g keeps inertia',()=>{
  const flat=new Sand(1),free=new Sand(1);
  place(flat,[[-40,160]]);place(free,[[-40,160]]);flat.vx[0]=free.vx[0]=100;
  for(let n=0;n<1/DT;n++){flat.step(0,0,650);free.step(0,0,0);}
  assert.ok(Math.abs(flat.vx[0])<1e-8,'front/back plates must dissipate flat-phone motion');
  assert.ok(free.vx[0]>60,'zero specific force must not invent plate pressure');
  const still=flat.snapshot();for(let n=0;n<30;n++)flat.step(60,0,650);
  assert.deepEqual(flat.snapshot(),still,'static plate friction must hold small tilts');
  for(let n=0;n<30;n++)flat.step(500,0,400);
  assert.ok(flat.vx[0]>10,'tilting past friction or shaking must release the sand');
  assert.throws(()=>flat.step(0,0,-1));assert.throws(()=>flat.step(0,0,NaN));
});

test('ten thousand fixed-volume grains keep their slope while flowing and do not creep after rest',async()=>{
  const {surfaceAngles}=await import('../scripts/benchmark.js');
  const sand=new Sand();
  for(let seconds=10;seconds<=150;seconds+=10){
    advance(sand,10);
    const angles=surfaceAngles(sand);
    assert.ok(angles.every(angle=>angle>30&&angle<38),`flowing slope at ${seconds}s: ${angles}`);
  }
  assert.equal(Array.from(sand.y).filter(y=>y<0).length,0);
  assert.ok(sand.sleeping);
  const angles=surfaceAngles(sand);
  assert.ok(angles.every(angle=>angle>30&&angle<37),`repose angles: ${angles}`);
  const still=sand.snapshot();advance(sand,30);assert.deepEqual(sand.snapshot(),still);
  console.log('Resting slope angles:',angles);
});
