export const DT = 1 / 120;
export const RADIUS = .65;
export const HEIGHT = 440;
export const COUNT = 10000;
export const PROFILE = [[-220,104],[-190,108],[-135,93],[-75,49],[-4,2.6],[4,2.6],[75,49],[135,93],[190,108],[220,104]];
export const outline = [...PROFILE.map(([y,x])=>[-x,y]), ...[...PROFILE].reverse().map(([y,x])=>[x,y])];
export function halfWidth(y) {
  for(let i=1;i<PROFILE.length;i++) {
    if(y<=PROFILE[i][0]) {
      const [a,x]=PROFILE[i-1], [b,z]=PROFILE[i];
      return x+(z-x)*(y-a)/(b-a);
    }
  }
  return PROFILE.at(-1)[1];
}
const CELL = RADIUS * 2, COLS = Math.ceil(224/CELL), ROWS = Math.ceil(444/CELL);
const DIRECTIONS = [];
for(let y=-3;y<=3;y++) for(let x=-3;x<=3;x++) {
  const length=Math.hypot(x,y);
  if(length && length<=3.7 && (Math.abs(x)===1 || Math.abs(y)===1 || (Math.abs(x)===3 && Math.abs(y)===2) || (Math.abs(x)===2 && Math.abs(y)===3))) DIRECTIONS.push({x,y,length});
}
// shortcut: lattice directions quantize repose; use a continuum solver if material calibration is needed.
export class Sand {
  constructor(count=COUNT) {
    if(!Number.isInteger(count)||count<1||count>COUNT) throw new RangeError('Invalid grain count');
    this.count=count; this.tick=0;
    this.x=new Float64Array(count); this.y=new Float64Array(count);
    this.vx=new Float64Array(count); this.vy=new Float64Array(count);
    this.cell=new Int32Array(count); this.travel=new Float64Array(count);
    this.grid=new Int32Array(COLS*ROWS); this.valid=new Uint8Array(COLS*ROWS);
    for(let cy=0;cy<ROWS;cy++) for(let cx=0;cx<COLS;cx++) {
      const x=this.worldX(cx), y=this.worldY(cy);
      this.valid[cy*COLS+cx]=Math.abs(y)<220-RADIUS && Math.abs(x)<halfWidth(y)-RADIUS;
    }
    this.gx=NaN; this.gy=NaN; this.directions=[]; this.sleeping=false;
    this.reset();
  }
  worldX(cx) {return (cx+.5)*CELL-112;}
  worldY(cy) {return (cy+.5)*CELL-222;}
  index(x,y) {
    const cx=Math.floor((x+112)/CELL), cy=Math.floor((y+222)/CELL);
    return cx>=0&&cx<COLS&&cy>=0&&cy<ROWS ? cy*COLS+cx : -1;
  }
  reset() {
    this.grid.fill(0); this.vx.fill(0); this.vy.fill(0); this.travel.fill(0); this.sleeping=false;
    let i=0;
    for(let cy=Math.floor((222-9)/CELL);cy>=0&&i<this.count;cy--) {
      for(let cx=0;cx<COLS&&i<this.count;cx++) {
        const k=cy*COLS+cx;
        if(!this.valid[k]) continue;
        this.x[i]=this.worldX(cx); this.y[i]=this.worldY(cy); this.cell[i]=k; this.grid[k]=++i;
      }
    }
    if(i<this.count) throw new RangeError('Grains exceed vessel capacity');
  }
  free(cx,cy) {
    if(cx<0||cx>=COLS||cy<0||cy>=ROWS) return false;
    const k=cy*COLS+cx;
    return this.valid[k] && !this.grid[k];
  }
  path(cx,cy,dx,dy) {
    const steps=Math.max(Math.abs(dx),Math.abs(dy));
    let direct=true;
    for(let n=1;n<=steps;n++) if(!this.free(cx+Math.round(dx*n/steps),cy+Math.round(dy*n/steps))) {direct=false;break;}
    if(direct) return true;
    // Surface grains can roll around a supporting cell's corner instead of locking to 45° stairs.
    if(Math.abs(this.gy)>=Math.abs(this.gx)) {
      for(let x=Math.sign(dx);dx && Math.abs(x)<=Math.abs(dx);x+=Math.sign(dx)) if(!this.free(cx+x,cy)) return false;
      for(let y=Math.sign(dy);dy && Math.abs(y)<=Math.abs(dy);y+=Math.sign(dy)) if(!this.free(cx+dx,cy+y)) return false;
    } else {
      for(let y=Math.sign(dy);dy && Math.abs(y)<=Math.abs(dy);y+=Math.sign(dy)) if(!this.free(cx,cy+y)) return false;
      for(let x=Math.sign(dx);dx && Math.abs(x)<=Math.abs(dx);x+=Math.sign(dx)) if(!this.free(cx+x,cy+dy)) return false;
    }
    return true;
  }
  move(i,x,y) {
    const k=this.index(x,y), old=this.cell[i];
    if(k<0 || !this.valid[k] || (k!==old && this.grid[k]) || Math.abs(y)>=220-RADIUS*.15 || Math.abs(x)>=halfWidth(y)-RADIUS*.15) return false;
    if(k!==old) {this.grid[old]=0;this.grid[k]=i+1;this.cell[i]=k;}
    this.x[i]=x;this.y[i]=y;return true;
  }
  step(gx=0,gy=650) {
    if(!Number.isFinite(gx)||!Number.isFinite(gy)||Math.hypot(gx,gy)>2600) throw new RangeError('Invalid gravity');
    this.tick++;
    if(!Number.isFinite(this.gx)||Math.hypot(gx-this.gx,gy-this.gy)>2) {
      this.sleeping=false;this.gx=gx;this.gy=gy;
      const length=Math.hypot(gx,gy)||1;
      this.directions=DIRECTIONS.map(d=>({...d,along:(d.x*gx+d.y*gy)/length,cross:Math.abs(d.x*gy-d.y*gx)/length}))
        .filter(d=>d.along>.64*d.cross).sort((a,b)=>b.along/b.length-a.along/a.length||a.length-b.length);
    }
    if(this.sleeping) return;
    let moving=false;
    const magnitude=Math.hypot(gx,gy);
    for(let k=0;k<this.count;k++) {
      const i=this.tick%2?k:this.count-1-k;
      let vx=this.vx[i]+gx*DT, vy=this.vy[i]+gy*DT;
      // Fine sand loses energy in the throat; outside it, velocity survives each sensor update.
      const drag=Math.exp(-(Math.abs(this.y[i])<7 ? 18 : .35)*DT);
      vx*=drag;vy*=drag;
      const dx=vx*DT,dy=vy*DT,steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/(CELL*.45)));
      let hit=false;
      for(let n=0;n<steps;n++) if(!this.move(i,this.x[i]+dx/steps,this.y[i]+dy/steps)) {hit=true;break;}
      if(!hit) {
        this.vx[i]=vx;this.vy[i]=vy;this.travel[i]=0;
        moving ||= Math.abs(vx)+Math.abs(vy)>.001;
        continue;
      }
      // Collisions are fully inelastic; a resting bed stores no spring energy to bounce back.
      this.vx[i]=0;this.vy[i]=0;
      const cx=this.cell[i]%COLS,cy=Math.floor(this.cell[i]/COLS);
      let slide;
      for(const d of this.directions) if(this.path(cx,cy,d.x,d.y)) {slide=d;break;}
      if(slide) {
        this.travel[i]+=(Math.sqrt(magnitude)*4+Math.hypot(vx,vy)*1.5)*DT;
        if(this.travel[i]>=slide.length*CELL) {
          this.move(i,this.worldX(cx+slide.x),this.worldY(cy+slide.y));
          this.travel[i]=0;
          this.vx[i]=slide.x/slide.length*Math.sqrt(magnitude)*.5;
          this.vy[i]=slide.y/slide.length*Math.sqrt(magnitude)*.5;
        }
        moving=true;
      } else this.travel[i]=0;
    }
    this.sleeping=!moving;
  }
  snapshot() {
    const data=new Float32Array(this.count*2);
    for(let i=0;i<this.count;i++) {data[i*2]=this.x[i];data[i*2+1]=this.y[i];}
    return data;
  }
}
