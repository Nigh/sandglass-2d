import { Sand, DT, initPhysics } from './physics.js';
let sand;
let wallNormal = 0;
let gravity = [0, 650], paused = false, previous = performance.now(), debt = 0, sent = 0;
self.onmessage = ({ data }) => {
  if (data.type === 'gravity' && Array.isArray(data.value) && data.value.length === 2 && data.value.every(Number.isFinite) && Number.isFinite(data.normal) && data.normal >= 0 && Math.hypot(...data.value,data.normal) <= 2600+1e-6) { gravity = data.value; wallNormal = data.normal; }
  if (data.type === 'pause') { paused = !!data.value; debt = 0; }
  if (data.type === 'reset') { sand?.reset(); debt = 0; }
};
initPhysics().then(() => {
  sand = new Sand();
  previous = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (!paused) debt = Math.min(debt + (now - previous) / 1000, DT * 12);
    previous = now;
    const start = performance.now();
    let steps = 0;
    while (debt >= DT) { sand.step(...gravity,wallNormal); debt -= DT; steps++; }
    if (now - sent >= 1000 / 60) {
      const positions = sand.snapshot(), velocities = new Float32Array(sand.count*2);
      for(let i=0;i<sand.count;i++) {velocities[i*2]=sand.vx[i];velocities[i*2+1]=sand.vy[i];}
      self.postMessage({ positions, velocities, ms: steps ? (performance.now() - start) / steps : 0, time: sand.tick * DT }, [positions.buffer, velocities.buffer]);
      sent = now;
    }
  }, 8);
}).catch((error) => self.postMessage({ error: String(error) }));
