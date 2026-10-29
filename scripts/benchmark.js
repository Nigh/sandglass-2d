import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { Sand, DT, COUNT, halfWidth } from '../src/physics.js';
export function surfaceAngles(sand) {
  return [-1,1].map(side=>{
    const points=[];
    for(let x=20;x<=75;x+=5) {
      let y=Infinity;
      for(let i=0;i<sand.count;i++) if(sand.y[i]>10 && Math.abs(sand.x[i]-side*x)<3) y=Math.min(y,sand.y[i]);
      if(Number.isFinite(y)) points.push([x,y]);
    }
    const n=points.length,sx=points.reduce((s,p)=>s+p[0],0),sy=points.reduce((s,p)=>s+p[1],0);
    const slope=(n*points.reduce((s,p)=>s+p[0]*p[1],0)-sx*sy)/(n*points.reduce((s,p)=>s+p[0]**2,0)-sx*sx);
    return Math.atan(slope)*180/Math.PI;
  });
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
  const sand=new Sand(),samples=[],flow=[];
  const seconds=600;
  let firstSettled=null;
  for(let n=0;n<Math.round(seconds/DT);n++) {
    const start=performance.now();sand.step();const ms=performance.now()-start;
    if(!sand.sleeping) samples.push(ms);
    if(sand.sleeping && firstSettled===null) firstSettled=(n+1)*DT;
    if((n+1)%Math.round(30/DT)===0) flow.push({seconds:(n+1)*DT,upper:Array.from(sand.y).filter(y=>y<0).length,surfaceAngles:surfaceAngles(sand)});
  }
  samples.sort((a,b)=>a-b);
  let escaped=0;
  for(let i=0;i<COUNT;i++) escaped+=Math.abs(sand.y[i])>220||Math.abs(sand.x[i])>halfWidth(sand.y[i]);
  const still=sand.snapshot();for(let n=0;n<5/DT;n++) sand.step();
  const after=sand.snapshot();let maxRestDisplacement=0;
  for(let i=0;i<after.length;i++) maxRestDisplacement=Math.max(maxRestDisplacement,Math.abs(after[i]-still[i]));
  console.log(JSON.stringify({cpu:os.cpus()[0].model,node:process.version,count:COUNT,physicsHz:1/DT,activeStepMedianMs:samples[Math.floor(samples.length*.5)],activeStepP95Ms:samples[Math.floor(samples.length*.95)],activeCpuMsPerSimulatedSecond:samples.reduce((a,b)=>a+b,0)/(samples.length*DT),flow,firstSettledSeconds:firstSettled,surfaceAngles:surfaceAngles(sand),restingDisplacementOver5Seconds:maxRestDisplacement,occupiedCells:new Set(sand.cell).size,escaped},null,2));
}
