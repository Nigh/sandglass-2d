import './style.css';
import { outline, RADIUS, COUNT } from './geometry.js';
import { screenAcceleration, motionPolarity } from './sensors.js';
const $ = (id) => document.getElementById(id);
const canvas = $('sand'), ctx = canvas.getContext('2d', { alpha: false });
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let simulationError = false;
let positions, velocities, physicsMs = 0, simTime = 0, paused = false, angle = 0, shownAngle = 0;
let sensor = false, lastReading = 0, sensorStarted = 0, pendingSensor = false, requestVersion = 0;
let wallNormal = 0;
let gravity = [0, 650], width = 0, height = 0, frames = 0, fps = 0, lastStats = performance.now();
let previousTime = 0, noticeTimer, wakeLock;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sensorPolarity = motionPolarity(navigator);
const colors = { gold: ['#b69761','#c9a86e','#d9bd88','#e8cf9d'], white: ['#a5b4af','#c0ceca','#d8e0d9','#edf0e5'], rose: ['#a5634e','#bf7f61','#d69a77','#e6b792'] };
let palette = colors.gold;
const grainBuckets = [[],[],[],[]], jitterX = new Float32Array(COUNT), jitterY = new Float32Array(COUNT);
for (let i=0;i<COUNT;i++) {
  let hash = Math.imul(i+1,0x45d9f3b); hash = Math.imul(hash^(hash>>>16),0x45d9f3b); hash ^= hash>>>16;
  grainBuckets[(hash>>>16)&3].push(i);
  jitterX[i]=((hash&255)/255-.5)*RADIUS*.55;
  jitterY[i]=(((hash>>>8)&255)/255-.5)*RADIUS*.55;
}
const glass = new Path2D();
outline.forEach(([x,y], i) => i ? glass.lineTo(x,y) : glass.moveTo(x,y)); glass.closePath();
function notice(text) {
  $('notice').textContent = text; $('notice').classList.add('visible');
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').classList.remove('visible'), 5000);
}
worker.onerror = () => { simulationError = true; $('state').textContent = '模拟启动失败'; notice('模拟遇到了问题，请刷新页面重试。'); };
worker.onmessage = ({ data }) => { if(data.error){worker.onerror();return;} positions = data.positions; velocities = data.velocities; physicsMs = data.ms || physicsMs; simTime = data.time; };
function sendGravity() { worker.postMessage({ type:'gravity', value:gravity, normal:wallNormal }); }
function manual(value = angle) {
  requestVersion++; pendingSensor = false; $('motion').disabled = false;
  sensor = false; wallNormal = 0; angle = value;
  gravity = [Math.sin(angle) * 650, Math.cos(angle) * 650]; sendGravity();
  $('mode').textContent = '手动把玩'; $('motion').innerHTML = '随手机倾斜 <span>↗</span>';
  $('hint').textContent = '左右拖动，倾斜沙漏 · 双击翻转';
}
function flip() {
  if (sensor) { notice('转动手机就能翻转；已切回手动模式。'); }
  manual(angle + Math.PI);
}
function pause() {
  paused = !paused; worker.postMessage({ type:'pause', value:paused });
  $('pause').setAttribute('aria-label', paused ? '继续' : '暂停');
  $('pause').setAttribute('aria-pressed', String(paused)); $('pause-icon').textContent = paused ? '▷' : 'Ⅱ';
}
$('flip').onclick = flip; $('pause').onclick = pause;
$('reset').onclick = () => { manual(0); worker.postMessage({ type:'reset' }); notice('砂已重新装好。'); };
$('palette').onchange = () => { palette = colors[$('palette').value]; };
$('settings').onclick = () => $('panel').showModal();
$('close').onclick = () => $('panel').close();
$('panel').addEventListener('click', (e) => { if (e.target === $('panel')) { const r = $('panel').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('panel').close(); } });
async function keepAwake() {
  if (!document.body.classList.contains('immersed') || document.hidden) return;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* Browser may decline power requests. */ }
}
async function immerse(value) {
  document.body.classList.toggle('immersed', value); $('immerse').setAttribute('aria-pressed', String(value));
  if (value) {
    keepAwake();
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.(); } catch { /* CSS immersion also works on iPhone. */ }
    notice('双击翻转 · 右下角退出');
  } else {
    await wakeLock?.release(); wakeLock = null;
    if (document.fullscreenElement) await document.exitFullscreen();
  }
}
$('immerse').onclick = () => immerse(true); $('leave').onclick = () => immerse(false);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('immersed')) immerse(false); });
document.addEventListener('visibilitychange', () => {
  worker.postMessage({ type:'pause', value:document.hidden || paused });
  previousTime = 0;
  if (sensor) { lastReading = 0; sensorStarted = performance.now(); gravity = [0,0]; wallNormal = 0; sendGravity(); }
  if (!document.hidden) keepAwake();
});
async function startSensors(automatic=false) {
  if(pendingSensor)return;
  if (!isSecureContext || !window.DeviceMotionEvent) { if(!automatic)notice('当前浏览器无法使用运动传感器。可以直接拖动沙漏来玩。'); return; }
  if(automatic){gravity=[0,0];wallNormal=0;sendGravity();$('mode').textContent='正在开启手机传感器';}
  const version = ++requestVersion;
  pendingSensor = true; $('motion').disabled = true;
  try {
    let timer;
    const permission = await Promise.race([
      window.DeviceMotionEvent.requestPermission ? window.DeviceMotionEvent.requestPermission() : Promise.resolve('granted'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 8000); }),
    ]).finally(() => clearTimeout(timer));
    if (version !== requestVersion) return;
    if (permission !== 'granted') { manual(0); notice('运动权限未获允许。可在浏览器设置中授权，或继续拖动把玩。'); return; }
    sensor = true; angle = 0; sensorStarted = performance.now(); lastReading = 0;
    gravity = [0,0]; wallNormal = 0; sendGravity();
    $('motion').textContent = '回到手动把玩 ↗'; $('mode').textContent = '等待手机读数';
    $('hint').textContent = '转动或轻轻摇晃手机，看砂流动';
  } catch {
    if(automatic){$('mode').textContent='等待传感器授权';$('motion').textContent='点击授权手机传感器 ↗';$('hint').textContent='点击下方授权，随后转动或摇晃手机';}
    else notice('未能开启传感器。请检查权限后重试；仍可拖动把玩。');
  }
  finally { if (version === requestVersion) { pendingSensor = false; $('motion').disabled = false; } }
}
$('motion').onclick=()=>{if(sensor||pendingSensor)manual(0);else void startSensors();};
window.addEventListener('devicemotion', (event) => {
  if (!sensor || document.hidden) return;
  const a = event.accelerationIncludingGravity;
  if (!a || a.x === null || a.y === null || a.z === null) return;
  const value = screenAcceleration(a.x, a.y, a.z, screen.orientation?.angle ?? window.orientation ?? 0, sensorPolarity * ($('polarity').checked ? -1 : 1));
  if (!value) return;
  gravity = value.gravity; wallNormal = value.normal; lastReading = performance.now(); sendGravity(); $('mode').textContent = wallNormal>200&&Math.hypot(...gravity)<wallNormal*.45?'平放 · 壁面摩擦':'随手机倾斜';
});
setInterval(() => {
  if (sensor && performance.now() - (lastReading || sensorStarted) > 1800) {
    gravity = [0,0]; wallNormal = 0; sendGravity(); $('mode').textContent = '手机读数已中断';
    if (lastReading !== -Infinity) notice('没有收到手机读数，已停止施加重力。可点击下方回到手动模式。');
    lastReading = -Infinity;
  }
}, 500);
let drag, lastTap = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) return;
  drag = { id:e.pointerId, x:e.clientX, y:e.clientY, angle, moved:false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  if (Math.hypot(e.clientX-drag.x,e.clientY-drag.y) > 8) drag.moved = true;
  if (drag.moved) manual(drag.angle + (e.clientX - drag.x) / 100);
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const now = performance.now();
  if (!drag.moved) { if (now - lastTap < 320) { flip(); lastTap = 0; } else lastTap = now; }
  drag = null;
});
canvas.addEventListener('pointercancel', () => { drag = null; });
window.addEventListener('keydown', (e) => {
  if ($('panel').open || /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  if (e.code === 'Space' && document.activeElement.tagName === 'BUTTON') return;
  if (e.code === 'Space') { e.preventDefault(); pause(); }
  if (e.code === 'KeyF') flip();
  if (e.code === 'ArrowLeft') { e.preventDefault(); manual(angle - Math.PI / 12); }
  if (e.code === 'ArrowRight') { e.preventDefault(); manual(angle + Math.PI / 12); }
  if (e.code === 'Escape' && document.body.classList.contains('immersed')) immerse(false);
});
new ResizeObserver(() => {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  width = rect.width; height = rect.height; canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
}).observe(canvas);
function render(now) {
  requestAnimationFrame(render);
  if (document.hidden || !width || !height) return;
  const elapsed = previousTime ? Math.min((now - previousTime)/1000,.05) : 0;
  previousTime = now;
  shownAngle += (angle - shownAngle) * (reducedMotion ? 1 : 1 - Math.exp(-elapsed * 12));
  ctx.setTransform(canvas.width / width,0,0,canvas.height / height,0,0);
  ctx.fillStyle = '#101719'; ctx.fillRect(0,0,width,height);
  // The entire vessel stays visible at any manual rotation.
  const a = shownAngle, sin = Math.abs(Math.sin(a)), cos = Math.abs(Math.cos(a));
  const scale = Math.min((width - 32)/(240*cos + 480*sin), (height - 64)/(480*cos + 240*sin), 1.7);
  ctx.translate(width/2,height/2); ctx.scale(scale,scale); ctx.rotate(a);
  ctx.fillStyle = '#152023'; ctx.fill(glass);
  ctx.save(); ctx.clip(glass);
  if (positions) {
    for (let c = 0; c < palette.length; c++) {
      ctx.fillStyle = palette[c]; ctx.beginPath();
      const streaks = new Path2D();
      for (const i of grainBuckets[c]) {
        const x = positions[i*2]+jitterX[i], y = positions[i*2+1]+jitterY[i];
        if (velocities && Math.hypot(velocities[i*2],velocities[i*2+1])>50) {
          streaks.moveTo(x,y); streaks.lineTo(x-velocities[i*2]/30,y-velocities[i*2+1]/30);
        }
        ctx.rect(x-RADIUS*.92,y-RADIUS*.92,RADIUS*1.84,RADIUS*1.84);
      }
      ctx.strokeStyle=palette[c];ctx.lineWidth=RADIUS*.9;ctx.globalAlpha=.45;ctx.stroke(streaks);ctx.globalAlpha=1;
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.lineWidth = 1.2; ctx.strokeStyle = '#72827d'; ctx.stroke(glass);
  ctx.strokeStyle = '#c7b38c'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  for (const y of [-226,226]) { ctx.beginPath(); ctx.moveTo(-116,y); ctx.lineTo(116,y); ctx.stroke(); }
  ctx.strokeStyle = '#344542'; ctx.lineWidth = 1;
  for (const side of [-1,1]) { ctx.beginPath(); ctx.moveTo(side*89,-184); ctx.quadraticCurveTo(side*85,-145,side*64,-117); ctx.stroke(); }
  frames++;
  if (now-lastStats > 750) {
    fps = Math.round(frames*1000/(now-lastStats)); frames = 0; lastStats = now;
    let upper = 0; if (positions) for (let i=1;i<positions.length;i+=2) upper += positions[i]<0;
    $('progress').textContent = `上腔 ${Math.round(upper/COUNT*100)}%`;
    $('state').textContent = simulationError ? '模拟启动失败' : paused ? '时间暂停了' : !positions ? '正在装砂' : sensor && !Number.isFinite(lastReading) ? '等待手机读数' : '让砂慢慢落下';
    $('diagnostic').textContent = `${COUNT.toLocaleString()} 粒砂 · ${fps} FPS · 物理 ${physicsMs.toFixed(2)} ms/步 · 已模拟 ${simTime.toFixed(1)} 秒`;
    canvas.dataset.fps = String(fps); canvas.dataset.time = simTime.toFixed(2); canvas.dataset.upper = String(upper);
  }
}
requestAnimationFrame(render);

if(matchMedia('(pointer: coarse)').matches||navigator.maxTouchPoints>0)void startSensors(true);
