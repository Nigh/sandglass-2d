// Device axes: x right, y up. Canvas axes: x right, y down.
export function screenGravity(x, y, angle = 0, polarity = -1) {
  if (![x, y, angle, polarity].every(Number.isFinite)) return null;
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const gx = (x * c - y * s) * 650 / 9.80665 * polarity;
  const gy = -(x * s + y * c) * 650 / 9.80665 * polarity;
  const scale = Math.min(1, 2600 / (Math.hypot(gx, gy) || 1));
  return [gx * scale, gy * scale];
}
