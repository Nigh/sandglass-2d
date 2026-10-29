import test from 'node:test';
import assert from 'node:assert/strict';
import { screenGravity, screenAcceleration, motionPolarity } from '../src/sensors.js';
test('specific force maps to downward gravity, including screen rotation and free fall', () => {
  const near = (a,b) => a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8));
  near(screenGravity(0,9.80665),[0,650]);
  near(screenGravity(9.80665,0,90),[0,650]);
  near(screenGravity(0,9.80665,0,1),[0,-650]);
  near(screenGravity(0,0),[0,0]);
  near(screenGravity(-19.6133,9.80665),[1300,650]);
  near(screenGravity(0,-9.80665),[0,-650]);
  assert.equal(screenGravity(NaN,3),null);
  near(screenGravity(0,6*9.80665),[0,3900]);
  assert.ok(Math.abs(Math.hypot(...screenGravity(1000,1000))-5200)<1e-6);
});

test('screen-normal acceleration supplies plate pressure instead of disappearing when flat',()=>{
  const flat=screenAcceleration(0,0,9.80665);
  assert.ok(Math.hypot(...flat.gravity)<1e-8);assert.ok(Math.abs(flat.normal-650)<1e-8);
  assert.equal(screenAcceleration(0,0,-9.80665).normal,flat.normal);
  assert.equal(screenAcceleration(0,9.80665,0).normal,0);
  const zero=screenAcceleration(0,0,0);assert.ok(zero.gravity.every(v=>v===0));assert.equal(zero.normal,0);
  const shake=screenAcceleration(100,100,100);
  assert.ok(Math.abs(Math.hypot(...shake.gravity,shake.normal)-5200)<1e-6);
  const belowLimit=screenAcceleration(0,6*9.80665,0);
  assert.ok(Math.abs(belowLimit.gravity[1]-3900)<1e-6);
  assert.equal(screenAcceleration(0,0,NaN),null);
});

test('platform normalization preserves gravity through rotation, inversion and manual override', () => {
  const platforms = [
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36' }, -1],
    [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1' }, 1],
    [{ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) CriOS/130 Mobile Safari/604.1' }, 1],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }, 1],
    [{ platform: 'MacIntel', maxTouchPoints: 0 }, -1],
    [{}, -1],
  ];
  for (const [device, expected] of platforms) {
    const polarity = motionPolarity(device);
    assert.equal(polarity, expected);
    for (const angle of [0, 90, 180, 270, -90]) {
      for (const [x,y,z] of [[0,9.80665,0], [4,-8,2], [0,0,9.80665], [0,0,0]]) {
        const reference = screenAcceleration(x,y,z,angle);
        const sign = -expected;
        const normalized = screenAcceleration(x*sign,y*sign,z*sign,angle,polarity);
        const reversed = screenAcceleration(x*sign,y*sign,z*sign,angle,-polarity);
        normalized.gravity.forEach((v,i) => {
          assert.ok(Math.abs(v-reference.gravity[i])<1e-8);
          assert.ok(Math.abs(reversed.gravity[i]+reference.gravity[i])<1e-8);
        });
        assert.equal(normalized.normal, reference.normal);
        assert.equal(reversed.normal, reference.normal);
      }
    }
  }
});
