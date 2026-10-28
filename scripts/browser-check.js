import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless:true, args:['--no-sandbox'] });
const errors = [];
const base = process.env.BASE_URL || 'http://localhost:5173';
try {
  const page = await browser.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(()=>Number(document.querySelector('canvas').dataset.time)>5);
  await page.screenshot({path:'docs/mobile.png'});
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.waitForTimeout(1000);
  const time = await page.locator('canvas').getAttribute('data-time');
  await page.waitForTimeout(1000); assert.equal(await page.locator('canvas').getAttribute('data-time'),time);
  await page.getByRole('button',{name:'继续',exact:true}).click();
  for(const [width,height] of [[320,568],[768,1024],[1024,768],[1440,900],[844,390]]) {
    await page.setViewportSize({width,height});
    await page.waitForTimeout(100);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const box = await page.locator('canvas').boundingBox(); assert.ok(box.width>100 && box.height>180);
    const flip = await page.locator('#flip').boundingBox(); assert.ok(flip.x>=0 && flip.x+flip.width<=width && flip.y+flip.height<=height);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#flip').click();
  await page.locator('#settings').click(); assert.ok(await page.locator('dialog').evaluate(e=>e.open));
  await page.selectOption('#palette','rose'); await page.locator('#close').click();
  await page.locator('#immerse').click(); assert.ok(await page.locator('body').evaluate(e=>e.classList.contains('immersed')));
  await page.locator('#leave').click(); assert.ok(!await page.locator('body').evaluate(e=>e.classList.contains('immersed')));
  await page.evaluate(()=>{Object.defineProperty(window,'DeviceMotionEvent',{configurable:true,value:class {static requestPermission(){return Promise.resolve('granted');}}});});
  await page.locator('#motion').click();
  await page.evaluate(()=>{const e=new Event('devicemotion');e.accelerationIncludingGravity={x:0,y:9.80665,z:0};window.dispatchEvent(e);});
  assert.equal(await page.locator('#mode').textContent(),'随手机倾斜');
  await page.waitForTimeout(2500); assert.equal(await page.locator('#mode').textContent(),'手机读数已中断');
  await page.locator('#motion').click(); assert.equal(await page.locator('#mode').textContent(),'手动把玩');
  await page.evaluate(()=>{window.DeviceMotionEvent.requestPermission=()=>Promise.resolve('denied');});
  await page.locator('#motion').click(); await page.waitForTimeout(100); assert.match(await page.locator('#notice').textContent(),/权限未获允许/);
  await page.setViewportSize({width:1440,height:900}); await page.goto(base); await page.waitForFunction(()=>Number(document.querySelector('canvas').dataset.time)>5); await page.screenshot({path:'docs/desktop.png'});
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: mobile, 5 viewports, pause, flip, settings, immersion, sensor permission/readings/staleness.');
} finally { await browser.close(); }
