import { Sand, DT } from './physics.js';
const sand = new Sand();
let gravity = [0, 650], paused = false, previous = performance.now(), debt = 0, sent = 0;
self.onmessage = ({ data }) => {
  if (data.type === 'gravity' && Array.isArray(data.value) && data.value.length === 2 && data.value.every(Number.isFinite) && Math.hypot(...data.value) <= 2600) gravity = data.value;
  if (data.type === 'pause') { paused = !!data.value; debt = 0; }
  if (data.type === 'reset') { sand.reset(); debt = 0; }
};
setInterval(() => {
  const now = performance.now();
  if (!paused) debt = Math.min(debt + (now - previous) / 1000, DT * 12);
  previous = now;
  const start = performance.now();
  let steps = 0;
  while (debt >= DT) { sand.step(...gravity); debt -= DT; steps++; }
  if (now - sent >= 1000 / 60) {
    const positions = sand.snapshot(), velocities = new Float32Array(sand.count*2);
    for(let i=0;i<sand.count;i++) {velocities[i*2]=sand.vx[i];velocities[i*2+1]=sand.vy[i];}
    self.postMessage({ positions, velocities, ms: steps ? (performance.now() - start) / steps : 0, time: sand.tick * DT }, [positions.buffer, velocities.buffer]);
    sent = now;
  }
}, 8);
