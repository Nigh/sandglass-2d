import { chromium } from '@playwright/test';
import { installMotionFixture } from './motion-fixture.js';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
  const results=[];
  for(const rate of [1,4]) {
    const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const cdp=await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate',{rate});
    await page.addInitScript(installMotionFixture);
    await page.addInitScript(()=>{
      window.physicsFrames=[];const NativeWorker=window.Worker;
      window.Worker=class extends NativeWorker{
        constructor(...args){super(...args);let previous;
          this.addEventListener('message',e=>{if(e.data.positions){
            const positions=e.data.positions;let changed=0;
            if(previous)for(let i=0;i<positions.length;i++)changed+=positions[i]!==previous[i];
            window.physicsFrames.push({at:performance.now(),time:e.data.time,changed});previous=positions;
          }});
        }
      };
    });
    await page.goto(process.env.BASE_URL||'http://localhost:5173');
    const start=Date.now(); await page.waitForTimeout(10000);
    results.push({cpuThrottle:rate,wallSeconds:(Date.now()-start)/1000,...await page.locator('canvas').evaluate(e=>({...e.dataset})),diagnostic:await page.locator('#diagnostic').textContent(),physicsUpdates:await page.evaluate(()=>{const frames=window.physicsFrames;const gaps=frames.slice(1).map((f,i)=>f.at-frames[i].at).sort((a,b)=>a-b);const elapsed=(frames.at(-1).at-frames[0].at)/1000;return {sampleSeconds:elapsed,count:frames.length,hz:(frames.length-1)/elapsed,changedSnapshots:frames.filter(f=>f.changed>0).length,changedHz:frames.filter(f=>f.changed>0).length/elapsed,gapP95Ms:gaps[Math.floor(gaps.length*.95)]};})});
    await page.close();
  }
  console.log(JSON.stringify(results,null,2));
} finally {await browser.close();}
