import test from 'node:test';
import assert from 'node:assert/strict';
import { screenGravity } from '../src/sensors.js';
test('specific force maps to downward gravity, including screen rotation and free fall', () => {
  const near = (a,b) => a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8));
  near(screenGravity(0,9.80665),[0,650]);
  near(screenGravity(9.80665,0,90),[0,650]);
  near(screenGravity(0,9.80665,0,1),[0,-650]);
  near(screenGravity(0,0),[0,0]);
  assert.equal(screenGravity(NaN,3),null);
  assert.ok(Math.hypot(...screenGravity(1000,1000))<=2600.00001);
});
