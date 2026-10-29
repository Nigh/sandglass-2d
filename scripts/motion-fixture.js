export function installMotionFixture({gestureRequired=false}={}){
  window.motionReading={x:0,y:9.80665,z:0};window.motionPermission='granted';window.motionRequests=0;
  Object.defineProperty(window,'DeviceMotionEvent',{configurable:true,value:class{
    static requestPermission(){
      window.motionRequests++;
      if(gestureRequired&&!navigator.userActivation.isActive)return Promise.reject(new DOMException('A user gesture is required','NotAllowedError'));
      return Promise.resolve(window.motionPermission);
    }
  }});
  setInterval(()=>{
    if(!window.motionReading)return;
    const event=new Event('devicemotion');event.accelerationIncludingGravity=window.motionReading;window.dispatchEvent(event);
  },50);
}
