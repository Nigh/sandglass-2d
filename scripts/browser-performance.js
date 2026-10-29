import { chromium } from '@playwright/test';
import { installMotionFixture } from './motion-fixture.js';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
  const results=[];
  for(const rate of [1,4]) {
    const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const cdp=await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate',{rate});
    await page.addInitScript(installMotionFixture);
    await page.goto(process.env.BASE_URL||'http://localhost:5173');
    const start=Date.now(); await page.waitForTimeout(10000);
    results.push({cpuThrottle:rate,wallSeconds:(Date.now()-start)/1000,...await page.locator('canvas').evaluate(e=>({...e.dataset})),diagnostic:await page.locator('#diagnostic').textContent()});
    await page.close();
  }
  console.log(JSON.stringify(results,null,2));
} finally {await browser.close();}
