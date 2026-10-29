// Accumulated contact impulses and split position correction: https://box2d.org/posts/2024/02/solver2d/
using u32=unsigned int;
using uptr=__UINTPTR_TYPE__;
extern "C" unsigned char __heap_base;
#define API(name) extern "C" __attribute__((export_name(name)))
static double min(double a,double b){return a<b?a:b;}
static double max(double a,double b){return a>b?a:b;}
static double abs(double a){return a<0?-a:a;}
static double clamp(double a,double b,double c){return max(b,min(c,a));}
static double root(double a){return __builtin_sqrt(a);}
static uptr arena;
static void* allocate(uptr bytes){uptr start=(arena+7)&~uptr(7);arena=start+bytes;uptr pages=__builtin_wasm_memory_size(0);if(arena>pages*65536)__builtin_wasm_memory_grow(0,(arena+65535)/65536-pages);return (void*)start;}
struct Contact{int i,j;u32 key;double nx,ny,depth,px,py,n,t;};
struct Wall{double x,y,dx,dy,length2;};
static int count,capacity,cols,rows,profileCount,wallCount,frame,which,used[2],hashSize;
static double radius,dt,frameDt,previousDt,impulseScale=1,gx0,gy0,normal0,quiet;
static bool asleep;
static double *x,*y,*vx,*vy,*oldX,*oldY;
static int *head,*entryNext,*entryId;
static u32 *seen;
static int entryCapacity;
static int *adjHead,*adjNext,*adjBody,*level,*queue,*bucket,*order;
static Contact* contacts[2];
static u32 *keys[2],*values[2];
static double profile[32];
static Wall walls[32];
API("init") int initialize(int n,double r,double step){
 if(n<1||n>10000||r<=0||step<=0)return 0;
 arena=(uptr)&__heap_base;count=n;radius=r;dt=frameDt=previousDt=step;capacity=32*n+32;cols=int(240/(r*2.2))+1;rows=int(460/(r*2.2))+1;hashSize=1;while(hashSize<capacity*1.25)hashSize*=2;
 x=(double*)allocate(n*8);y=(double*)allocate(n*8);vx=(double*)allocate(n*8);vy=(double*)allocate(n*8);oldX=(double*)allocate(n*8);oldY=(double*)allocate(n*8);head=(int*)allocate(cols*rows*4);entryCapacity=128*n;entryNext=(int*)allocate(entryCapacity*4);entryId=(int*)allocate(entryCapacity*4);seen=(u32*)allocate(n*4);adjHead=(int*)allocate(n*4);adjNext=(int*)allocate(2*capacity*4);adjBody=(int*)allocate(2*capacity*4);level=(int*)allocate(n*4);queue=(int*)allocate(n*4);bucket=(int*)allocate((n+3)*4);order=(int*)allocate(capacity*4);
 for(int b=0;b<2;b++){contacts[b]=(Contact*)allocate(capacity*sizeof(Contact));keys[b]=(u32*)allocate(hashSize*4);values[b]=(u32*)allocate(hashSize*4);}
 return 1;
}
API("x_ptr") uptr xp(){return (uptr)x;} API("y_ptr") uptr yp(){return (uptr)y;}
API("vx_ptr") uptr vxp(){return (uptr)vx;} API("vy_ptr") uptr vyp(){return (uptr)vy;}
API("profile_ptr") uptr pp(){return (uptr)profile;}
static void point(int i,double& a,double& b){int j=i<profileCount?i:2*profileCount-1-i;a=profile[2*j+1]*(i<profileCount?-1:1);b=profile[2*j];}
API("configure") void configure(int n){profileCount=n;wallCount=2*n;for(int i=0;i<wallCount;i++){double a,b,c,d;point(i,a,b);point((i+1)%wallCount,c,d);walls[i]={a,b,c-a,d-b,(c-a)*(c-a)+(d-b)*(d-b)};}}
static double width(double yy){for(int i=1;i<profileCount;i++)if(yy<=profile[2*i]){double t=(yy-profile[2*i-2])/(profile[2*i]-profile[2*i-2]);return profile[2*i-1]+t*(profile[2*i+1]-profile[2*i-1]);}return profile[2*profileCount-1];}
API("reset") void reset(){frame=0;which=0;used[0]=used[1]=0;asleep=false;quiet=0;gx0=0;gy0=650;normal0=0;for(int i=0;i<count;i++){vx[i]=vy[i]=0;}for(int b=0;b<2;b++)for(int k=0;k<hashSize;k++)keys[b][k]=0;}
static bool add(int i,int j,double nx,double ny,double depth,u32 key,double px=0,double py=0){
 if(used[which]>=capacity)return false;
 Contact c={i,j,key,nx,ny,depth,px,py,0,0};u32 slot=(key*2654435761u)&(hashSize-1);int before=1-which;
 while(keys[before][slot]&&keys[before][slot]!=key)slot=(slot+1)&(hashSize-1);
 if(keys[before][slot]==key){Contact& previous=contacts[before][values[before][slot]];if(nx*previous.nx+ny*previous.ny>.9){c.n=previous.n*impulseScale;c.t=previous.t*impulseScale;}}
 slot=(key*2654435761u)&(hashSize-1);while(keys[which][slot])slot=(slot+1)&(hashSize-1);keys[which][slot]=key;values[which][slot]=used[which];contacts[which][used[which]++]=c;return true;
}
static void nearest(int i,double& distance,double& nx,double& ny,double& px,double& py,int& index){
 double best=1e100;for(int w=0;w<wallCount;w++){Wall& a=walls[w];double t=clamp(((x[i]-a.x)*a.dx+(y[i]-a.y)*a.dy)/a.length2,0,1),xx=a.x+t*a.dx,yy=a.y+t*a.dy,d=(x[i]-xx)*(x[i]-xx)+(y[i]-yy)*(y[i]-yy);if(d<best){best=d;px=xx;py=yy;index=w;}}
 bool inside=abs(y[i])<=220&&abs(x[i])<=width(y[i]);double d=root(best),sign=inside?1:-1;distance=sign*d;
 if(d>1e-10){nx=(x[i]-px)/d*sign;ny=(y[i]-py)/d*sign;}else{Wall& a=walls[index];double len=root(a.length2);nx=a.dy/len;ny=-a.dx/len;}
}
static bool detect(){
 double cell=radius*2.2,skin=radius*.08;
 used[which]=0;for(int k=0;k<hashSize;k++)keys[which][k]=0;for(int k=0;k<cols*rows;k++)head[k]=-1;for(int i=0;i<count;i++)seen[i]=0;
 int entries=0;
 // Broad phase covers entire predicted trajectories, including crossing counterflows.
 for(int i=0;i<count;i++){
  int x0=int(clamp(__builtin_floor((min(oldX[i],x[i])+120-radius-skin)/cell),0,cols-1)),x1=int(clamp(__builtin_floor((max(oldX[i],x[i])+120+radius+skin)/cell),0,cols-1));
  int y0=int(clamp(__builtin_floor((min(oldY[i],y[i])+230-radius-skin)/cell),0,rows-1)),y1=int(clamp(__builtin_floor((max(oldY[i],y[i])+230+radius+skin)/cell),0,rows-1));
  for(int yy=y0;yy<=y1;yy++)for(int xx=x0;xx<=x1;xx++){if(entries>=entryCapacity)return false;int k=yy*cols+xx;entryId[entries]=i;entryNext[entries]=head[k];head[k]=entries++;}
 }
 for(int i=0;i<count;i++){
  int x0=int(clamp(__builtin_floor((min(oldX[i],x[i])+120-radius-skin)/cell),0,cols-1)),x1=int(clamp(__builtin_floor((max(oldX[i],x[i])+120+radius+skin)/cell),0,cols-1));
  int y0=int(clamp(__builtin_floor((min(oldY[i],y[i])+230-radius-skin)/cell),0,rows-1)),y1=int(clamp(__builtin_floor((max(oldY[i],y[i])+230+radius+skin)/cell),0,rows-1));
  for(int yy=y0;yy<=y1;yy++)for(int xx=x0;xx<=x1;xx++)for(int e=head[yy*cols+xx];e>=0;e=entryNext[e]){
   int j=entryId[e];if(j>=i||seen[j]==u32(i+1))continue;seen[j]=i+1;
   double dx=oldX[i]-oldX[j],dy=oldY[i]-oldY[j],d=root(dx*dx+dy*dy),nx=d?dx/d:1,ny=d?dy/d:0;
   double rvx=vx[i]-vx[j],rvy=vy[i]-vy[j],speed2=rvx*rvx+rvy*rvy;
   double time=speed2>1e-12?clamp(-(dx*rvx+dy*rvy)/speed2,0,dt):0;
   double nearX=dx+rvx*time,nearY=dy+rvy*time,limit=2*radius+skin;
   if(nearX*nearX+nearY*nearY>limit*limit)continue;
   double gap=d-2*radius,closing=rvx*nx+rvy*ny;
   if(gap+min(0,closing)*dt>skin)continue;
   if(!add(i,j,nx,ny,-gap,u32(i*count+j+1)))return false;
  }
  double moveX=x[i]-oldX[i],moveY=y[i]-oldY[i],reach=root(moveX*moveX+moveY*moveY)+radius+skin;
  if(abs(oldY[i])<220-reach&&abs(oldX[i])<width(oldY[i])-reach*2)continue;
  for(int w=0;w<wallCount;w++){
   Wall& wall=walls[w];double t=clamp(((oldX[i]-wall.x)*wall.dx+(oldY[i]-wall.y)*wall.dy)/wall.length2,0,1),px=wall.x+t*wall.dx,py=wall.y+t*wall.dy,dx=oldX[i]-px,dy=oldY[i]-py,d=root(dx*dx+dy*dy);
   if(d>reach)continue;double nx=d>1e-10?dx/d:wall.dy/root(wall.length2),ny=d>1e-10?dy/d:-wall.dx/root(wall.length2),gap=d-radius;
   if(gap+min(0,vx[i]*nx+vy[i]*ny)*dt>skin)continue;
   if(!add(i,-1,nx,ny,-gap,u32(count*count+i*wallCount+w+1),px,py))return false;
  }
 }
 return true;
}
// Order constraint relaxation by actual wall-connected support, never by grain IDs or motion.
static void supportOrder(){
 for(int i=0;i<count;i++){adjHead[i]=-1;level[i]=-1;}for(int i=0;i<count+3;i++)bucket[i]=0;
 int edges=0,tail=0;Contact* active=contacts[which];int length=used[which];
 for(int a=0;a<length;a++){Contact& c=active[a];if(c.j<0){if(level[c.i]<0){level[c.i]=0;queue[tail++]=c.i;}}else{adjBody[edges]=c.j;adjNext[edges]=adjHead[c.i];adjHead[c.i]=edges++;adjBody[edges]=c.i;adjNext[edges]=adjHead[c.j];adjHead[c.j]=edges++;}}
 for(int q=0;q<tail;q++){int i=queue[q];for(int e=adjHead[i];e>=0;e=adjNext[e]){int j=adjBody[e];if(level[j]<0){level[j]=level[i]+1;queue[tail++]=j;}}}
 for(int a=0;a<length;a++){Contact& c=active[a];int d=c.j<0?0:level[c.i]<0?count+1:int(max(level[c.i],level[c.j]))+1;bucket[d+1]++;}
 for(int i=1;i<count+3;i++)bucket[i]+=bucket[i-1];
 for(int a=0;a<length;a++){Contact& c=active[a];int d=c.j<0?0:level[c.i]<0?count+1:int(max(level[c.i],level[c.j]))+1;order[bucket[d]++]=a;}
}
static void impulse(Contact& c,double normal,double tangent){double ix=c.nx*normal-c.ny*tangent,iy=c.ny*normal+c.nx*tangent;vx[c.i]+=ix;vy[c.i]+=iy;if(c.j>=0){vx[c.j]-=ix;vy[c.j]-=iy;}}
static int microStep(double gx,double gy,double normal){
 frame++;
 if((gx-gx0)*(gx-gx0)+(gy-gy0)*(gy-gy0)+(normal-normal0)*(normal-normal0)>4){asleep=false;quiet=0;gx0=gx;gy0=gy;normal0=normal;for(int b=0;b<2;b++)for(int k=0;k<hashSize;k++)keys[b][k]=0;}
 if(asleep)return 1;
 double drag=1/(1+.35*dt);
 for(int i=0;i<count;i++){oldX[i]=x[i];oldY[i]=y[i];vx[i]=(vx[i]+gx*dt)*drag;vy[i]=(vy[i]+gy*dt)*drag;double speed=root(vx[i]*vx[i]+vy[i]*vy[i]),limit=.45*normal*dt;if(speed<=limit){vx[i]=vy[i]=0;}else if(speed>0){double friction=max(0,1-.35*normal*dt/speed);vx[i]*=friction;vy[i]*=friction;}x[i]+=vx[i]*dt;y[i]+=vy[i]*dt;}
 which=1-which;if(!detect())return -1;
 Contact* active=contacts[which];int length=used[which];supportOrder();
 for(int a=0;a<length;a++)impulse(active[a],active[a].n,active[a].t);
 for(int pass=0;pass<6;pass++){double largestImpulse=0;for(int a=0;a<length;a++){
  Contact& c=active[order[a]];int i=c.i,j=c.j;double mass=j<0?1:.5,rx=vx[i]-(j<0?0:vx[j]),ry=vy[i]-(j<0?0:vy[j]);
  double vn=rx*c.nx+ry*c.ny,bias=max(0,-c.depth)/dt,normal=max(0,c.n-(vn+bias)*mass),change=normal-c.n;c.n=normal;impulse(c,change,0);
  rx=vx[i]-(j<0?0:vx[j]);ry=vy[i]-(j<0?0:vy[j]);double limit=(j<0?.08:.65)*c.n,tangent=clamp(c.t-(-rx*c.ny+ry*c.nx)*mass,-limit,limit);largestImpulse=max(largestImpulse,abs(change)+abs(tangent-c.t));impulse(c,0,tangent-c.t);c.t=tangent;
 }if(largestImpulse<1e-8)break;
 }
 // Integrate solved velocities. Penetration repair must never become a bounce velocity.
 for(int i=0;i<count;i++){x[i]=oldX[i]+vx[i]*dt;y[i]=oldY[i]+vy[i]*dt;}
 // Rebuild position contacts after integration: solved velocities can create new neighbours.
 for(int pass=0;pass<5;pass++){
  double largestCorrection=0,cell=radius*2.2;
  for(int k=0;k<cols*rows;k++)head[k]=-1;
  for(int i=0;i<count;i++){int cx=int(clamp(__builtin_floor((x[i]+120)/cell),0,cols-1)),cy=int(clamp(__builtin_floor((y[i]+230)/cell),0,rows-1)),k=cy*cols+cx;entryNext[i]=head[k];head[k]=i;}
  for(int i=0;i<count;i++){
   int cx=int(clamp(__builtin_floor((x[i]+120)/cell),0,cols-1)),cy=int(clamp(__builtin_floor((y[i]+230)/cell),0,rows-1));
   for(int yy=max(0,cy-1);yy<=min(rows-1,cy+1);yy++)for(int xx=max(0,cx-1);xx<=min(cols-1,cx+1);xx++)for(int j=head[yy*cols+xx];j>=0;j=entryNext[j]){
    if(j>=i)continue;double dx=x[i]-x[j],dy=y[i]-y[j],d2=dx*dx+dy*dy;if(d2>=4*radius*radius)continue;double d=root(d2),nx=d?dx/d:1,ny=d?dy/d:0,amount=max(0,2*radius-d-radius*.015)*.25;largestCorrection=max(largestCorrection,amount);x[i]+=nx*amount;y[i]+=ny*amount;x[j]-=nx*amount;y[j]-=ny*amount;
   }
   if(abs(y[i])>220-radius||abs(x[i])>width(y[i])-radius){double d,nx,ny,px,py;int w=0;nearest(i,d,nx,ny,px,py,w);if(d<radius){largestCorrection=max(largestCorrection,radius-d);x[i]+=nx*(radius-d);y[i]+=ny*(radius-d);}}
  }
  if(largestCorrection<1e-7)break;
 }
 // A final glass projection also contains extreme shaking and sharp boundary corners.
 for(int i=0;i<count;i++)if(abs(y[i])>220-radius||abs(x[i])>width(y[i])-radius){double d,nx,ny,px,py;int w=0;nearest(i,d,nx,ny,px,py,w);if(d<radius){x[i]+=nx*(radius-d);y[i]+=ny*(radius-d);double vn=vx[i]*nx+vy[i]*ny;if(vn<0){vx[i]-=vn*nx;vy[i]-=vn*ny;}}}
 double sum=0,maximum=0;for(int i=0;i<count;i++){double speed=vx[i]*vx[i]+vy[i]*vy[i];sum+=speed;maximum=max(maximum,speed);}
 quiet=sum/count<.04&&maximum<1?quiet+dt:0;if(quiet>1){asleep=true;for(int i=0;i<count;i++)vx[i]=vy[i]=0;}
 return 1;
}
// Small steps for bulk impacts; a sparse falling stream does not force the whole bed to substep.
API("step") int step(double gx,double gy,double normal){
 double energy=0;for(int i=0;i<count;i++)energy+=vx[i]*vx[i]+vy[i]*vy[i];
 double bulk=root(energy/count),force=root(gx*gx+gy*gy);
 int steps=force>1300?6:force>900?3:1;
 int speedSteps=int(__builtin_ceil(bulk*frameDt/(radius*.8)));
 steps=int(clamp(max(steps,speedSteps),1,8));
 dt=frameDt/steps;
 for(int i=0;i<steps;i++){impulseScale=dt/previousDt;int result=microStep(gx,gy,normal);previousDt=dt;if(result<0)return result;}
 return 1;
}
API("sleeping") int sleeping(){return asleep;}
API("contact_count") int contact_count(){return used[which];}
