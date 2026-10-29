import test from 'node:test';
import assert from 'node:assert/strict';
import { screenGravity, screenAcceleration } from '../src/sensors.js';
test('specific force maps to downward gravity, including screen rotation and free fall', () => {
  const near = (a,b) => a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8));
  near(screenGravity(0,9.80665),[0,650]);
  near(screenGravity(9.80665,0,90),[0,650]);
  near(screenGravity(0,9.80665,0,1),[0,-650]);
  near(screenGravity(0,0),[0,0]);
  near(screenGravity(-19.6133,9.80665),[1300,650]);
  near(screenGravity(0,-9.80665),[0,-650]);
  assert.equal(screenGravity(NaN,3),null);
  assert.ok(Math.hypot(...screenGravity(1000,1000))<=2600.00001);
});

test('screen-normal acceleration supplies plate pressure instead of disappearing when flat',()=>{
  const flat=screenAcceleration(0,0,9.80665);
  assert.ok(Math.hypot(...flat.gravity)<1e-8);assert.ok(Math.abs(flat.normal-650)<1e-8);
  assert.equal(screenAcceleration(0,0,-9.80665).normal,flat.normal);
  assert.equal(screenAcceleration(0,9.80665,0).normal,0);
  const zero=screenAcceleration(0,0,0);assert.ok(zero.gravity.every(v=>v===0));assert.equal(zero.normal,0);
  const shake=screenAcceleration(100,100,100);
  assert.ok(Math.hypot(...shake.gravity,shake.normal)<=2600+1e-6);
  assert.equal(screenAcceleration(0,0,NaN),null);
});
