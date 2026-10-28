import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { Sand, DT, COUNT, RADIUS, halfWidth } from '../src/physics.js';
export function surfaceAngles(sand) {
  const slopes = [-1, 1].map(side => {
    const points = [];
    for (let x = 20; x <= 75; x += 5) {
      let y = Infinity;
      for (let i = 0; i < sand.count; i++) if (Math.abs(sand.x[i] - side * x) < 3) y = Math.min(y, sand.y[i]);
      if (Number.isFinite(y)) points.push([x,y]);
    }
    const n = points.length, sx = points.reduce((s,p)=>s+p[0],0), sy = points.reduce((s,p)=>s+p[1],0);
    const slope = (n*points.reduce((s,p)=>s+p[0]*p[1],0)-sx*sy)/(n*points.reduce((s,p)=>s+p[0]**2,0)-sx*sx);
    return Math.atan(slope)*180/Math.PI;
  });
  return slopes;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const sand = new Sand(), samples = [], flow = [];
  for (let n=0; n<30/DT; n++) {
    const start = performance.now(); sand.step(); samples.push(performance.now()-start);
    if ((n+1)%4800===0) flow.push({ seconds:(n+1)*DT, upper:Array.from(sand.y).filter(y=>y<0).length });
  }
  samples.sort((a,b)=>a-b);
  let escaped = 0;
  for(let i=0;i<COUNT;i++) escaped += Math.abs(sand.y[i])>220 || Math.abs(sand.x[i])>halfWidth(sand.y[i]);
  let maxOverlap = 0;
  for (let i=0;i<COUNT;i++) for(let j=0;j<i;j++) maxOverlap=Math.max(maxOverlap,1-Math.hypot(sand.x[i]-sand.x[j],sand.y[i]-sand.y[j])/(2*RADIUS));
  const rmsSpeed = Math.sqrt(sand.vx.reduce((sum,v,i)=>sum+v*v+sand.vy[i]**2,0)/COUNT);
  console.log(JSON.stringify({ cpu:os.cpus()[0].model, node:process.version, count:COUNT, physicsHz:1/DT, stepMedianMs:samples[Math.floor(samples.length*.5)], stepP95Ms:samples[Math.floor(samples.length*.95)], cpuMsPerSimulatedSecond:samples.reduce((a,b)=>a+b,0)/30, flow, surfaceAngles:surfaceAngles(sand), maxOverlapFraction:maxOverlap, rmsSpeed, escaped },null,2));
}
