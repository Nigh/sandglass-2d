import { DT, RADIUS, COUNT, PROFILE, halfWidth } from './geometry.js';
export { DT, RADIUS, COUNT, HEIGHT, PROFILE, outline, halfWidth } from './geometry.js';
let compiled;
export async function initPhysics(bytes) {
  if(compiled)return;
  if(!bytes){
    const response=await fetch(new URL('./sand.wasm',import.meta.url));
    if(!response.ok)throw new Error(`物理内核加载失败（${response.status}）`);
    bytes=await response.arrayBuffer();
  }
  compiled=await WebAssembly.compile(bytes);
}
export class Sand {
  constructor(count=COUNT) {
    if(!Number.isInteger(count)||count<1||count>COUNT)throw new RangeError('Invalid grain count');
    if(!compiled)throw new Error('Call initPhysics before creating sand');
    this.count=count;this.tick=0;
    this.native=new WebAssembly.Instance(compiled).exports;
    if(!this.native.init(count,RADIUS,DT))throw new Error('Physics allocation failed');
    for(const name of ['x','y','vx','vy'])this[name]=new Float64Array(this.native.memory.buffer,this.native[`${name}_ptr`](),count);
    new Float64Array(this.native.memory.buffer,this.native.profile_ptr(),PROFILE.length*2).set(PROFILE.flat());
    this.native.configure(PROFILE.length);this.reset();
  }
  reset() {
    this.native.reset();this.sleeping=false;
    let i=0,row=0;
    for(let y=-9;y>-218&&i<this.count;y-=RADIUS*1.79){
      const width=halfWidth(y)-RADIUS*1.5;
      for(let x=-width+row%2*RADIUS;x<=width&&i<this.count;x+=RADIUS*2.06){this.x[i]=x;this.y[i++]=y;}
      row++;
    }
    if(i<this.count)throw new RangeError('Grains exceed vessel capacity');
  }
  step(gx=0,gy=650,normal=0) {
    if(![gx,gy,normal].every(Number.isFinite)||normal<0||Math.hypot(gx,gy,normal)>2600+1e-6)throw new RangeError('Invalid gravity');
    if(this.native.step(gx,gy,normal)<0)throw new Error(`Particle contact capacity exceeded (${this.native.contact_count()} contacts)`);
    this.tick++;this.sleeping=!!this.native.sleeping();
  }
  snapshot() {
    const positions=new Float32Array(this.count*2);
    for(let i=0;i<this.count;i++){positions[i*2]=this.x[i];positions[i*2+1]=this.y[i];}
    return positions;
  }
}
