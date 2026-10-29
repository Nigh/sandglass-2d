// iOS WebKit reports gravity with the opposite sign to Android.
// iPadOS desktop mode identifies as a touch-capable Mac.
export function motionPolarity({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  return /iPad|iPhone|iPod/.test(userAgent) ||
    (/Mac/.test(platform) && maxTouchPoints > 1) ? 1 : -1;
}

// Device axes: x right, y up. Canvas axes: x right, y down.
export function screenGravity(x, y, angle = 0, polarity = -1) {
  if (![x, y, angle, polarity].every(Number.isFinite)) return null;
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const gx = (x * c - y * s) * 650 / 9.80665 * polarity;
  const gy = -(x * s + y * c) * 650 / 9.80665 * polarity;
  const scale = Math.min(1, 5200 / (Math.hypot(gx, gy) || 1));
  return [gx * scale, gy * scale];
}
// The screen-normal component loads the front/back plates of the shallow vessel.
export function screenAcceleration(x,y,z,angle=0,polarity=-1) {
  if(![x,y,z,angle,polarity].every(Number.isFinite))return null;
  const scale=Math.min(1,8*9.80665/(Math.hypot(x,y,z)||1));
  return { gravity:screenGravity(x*scale,y*scale,angle,polarity), normal:Math.abs(z)*scale*650/9.80665 };
}
