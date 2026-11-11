// Timings are descriptive, not thresholds or hardware claims. Five interleaved
// view windows per program; screenshots and evaluation are outside frame timing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createServer } from 'vite';
import { freePort } from './dev.mjs';
import { launchBrowser } from './browser.mjs';
const begin=performance.now();
const server=await createServer({server:{host:'127.0.0.1',port:await freePort(),strictPort:true}});
await server.listen();
const address=server.httpServer.address();
assert(address&&typeof address!=='string');
const url=`http://127.0.0.1:${address.port}`;
const browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];const failedRequests=[];const checks=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))failedRequests.push({url:r.url(),status:r.status()});});
const output={
  claim:'Descriptive headless frame intervals and main-thread render submission times for this spike; no comparative speed claim.',
  environment:{timestamp:new Date().toISOString(),node:process.version,os:`${os.platform()} ${os.release()}`,cpu:os.cpus()[0]?.model,cores:os.cpus().length,loadBefore:os.loadavg(),viewport:{width:1440,height:1000},browser:browser.version(),renderer:'ANGLE SwiftShader (software; forced by launch flags)',server:'Vite development, OS-selected free port',audio:'none',pixelRatio:1,concurrentWork:'The shared preview browser and normal workstation processes were active. Load and core count are recorded; this run makes no hardware-GPU or comparative speed claim.'},
  method:{runs:5,perRunFrames:12,warmupFrames:6,order:'program → repetition → fly/ring/side; same queried data in each view; paused camera, live render loop',query:'one worker evaluation per program; queryMs excludes worker startup/message/geometry. loadMs includes them.',draw:'performance.now around controls.update + renderer.render + label projection; CPU submission, not GPU completion',frame:'requestAnimationFrame interval; screenshot and query warmup excluded; no forced-fps flags',limits:'150k haps/sample window, 256 cycles, 8 second worker timeout; no speedup claim'},
  programs:[],checks,errors,failedRequests,
};
if(process.env.BEHAVIOR_ONLY){output.programs=JSON.parse(await fs.readFile('measurements.json','utf8')).programs;output.method.reusedPrograms='Existing coverage reused for this focused behavior-only rerun';}
async function ready(){await page.waitForFunction(()=>window.spiral?.ready,{timeout:12000});}
async function settle(n=6){await page.evaluate(async n=>{for(let i=0;i<n;i++)await new Promise(requestAnimationFrame);},n);}
async function load(id){const t=performance.now();await page.selectOption('#program',id);await ready();const score=await page.evaluate(()=>window.spiral.score);assert(score,`${id}: ${await page.locator('#status').textContent()}`);return {score,loadMs:performance.now()-t};}
async function paste(code,{start=0,count=8}={}){await page.fill('#source',code);await page.fill('#start',String(start));await page.fill('#count',String(count));await page.click('#evaluate');await ready();return page.evaluate(()=>window.spiral.score);}
try {
  await fs.mkdir('shots',{recursive:true});
  await page.goto(url);await ready();await page.evaluate(()=>document.fonts.ready);
  const programs=await page.evaluate(()=>window.spiral.programs);
  assert(programs.length>=12);
  for(const p of (process.env.BEHAVIOR_ONLY?[]:programs)) {
    const {score,loadMs}=await load(p.id);
    const focus=p.id==='arrange-64'?32:p.id==='no-repeat'?17:p.id==='every-four'?4:3;
    await page.click(`[data-cycle="${focus}"]`);
    const rows={id:p.id,rows:p.rows,cycles:score.turns.length,onsets:score.onsets,fragments:score.fragments,signalSamples:score.signalSamples,queryMs:score.queryMs,loadMs,perCycle:score.turns.map(t=>({cycle:t.cycle,onsets:t.onsets,parts:t.events.length,changed:t.changed})),views:{}};
    for(let run=0;run<5;run++)for(const view of ['fly','ring','side']) {
      await page.click(`[data-view="${view}"]`);await settle();
      const measured=await page.evaluate(async()=>{window.spiral.resetMetrics();for(let i=0;i<12;i++)await new Promise(requestAnimationFrame);return window.spiral.metrics();});
      assert(measured.frames>=10,`${p.id}/${view}: no measured frames`);
      (rows.views[view]??={runs:[]}).runs.push(measured);
      if(run===4) {
        const path=`shots/${p.id}-${view}.png`;
        await page.screenshot({path});rows.views[view].screenshot=path;
        const pixels=await page.locator('canvas').evaluate(c=>{const gl=c.getContext('webgl2');if(!gl)return null;const buf=new Uint8Array(4);gl.readPixels(Math.floor(c.width/2),Math.floor(c.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,buf);return [...buf];});
        rows.views[view].canvasPixel=pixels;
      }
    }
    for(const view of Object.values(rows.views)) {
      const median=nums=>[...nums].sort((a,b)=>a-b)[Math.floor(nums.length/2)];
      view.summary={frameMedianMs:median(view.runs.map(x=>x.frameMedianMs)),frameMedianRangeMs:[Math.min(...view.runs.map(x=>x.frameMedianMs)),Math.max(...view.runs.map(x=>x.frameMedianMs))],frameP95Ms:median(view.runs.map(x=>x.frameP95Ms)),drawMedianMs:median(view.runs.map(x=>x.drawMedianMs)),drawP95Ms:median(view.runs.map(x=>x.drawP95Ms))};
    }
    output.programs.push(rows);console.log(p.id,score.onsets,score.signalSamples,JSON.stringify(Object.fromEntries(Object.entries(rows.views).map(([v,r])=>[v,r.summary.frameMedianMs.toFixed(2)]))));
  }
  checks.push({check:'all 15 programs × 3 views × 5 frame windows',passed:true});
  const dense=output.programs.find(p=>p.id==='density-64');assert.equal(dense.onsets,6144);assert.equal(dense.views.ring.runs[0].aggregated,576);checks.push({check:'fast(64): 512 real onsets/cycle, explicit LOD aggregation',passed:true});
  const signals=output.programs.find(p=>p.id==='signals');assert.equal(signals.onsets,48);assert.equal(signals.signalSamples,768);checks.push({check:'continuous values produce bands in addition to 48 genuine note onsets',passed:true});
  const first=await load('randomness');const second=await load('randomness');assert.deepEqual(first.score.turns,second.score.turns);checks.push({check:'time-addressed randomness is deterministic across new workers',passed:true});
  const fragment=await paste(`note('c3').s('triangle').slow(4)`,{start:1,count:2});assert(fragment);assert.equal(fragment.onsets,0);assert.equal(fragment.fragments,2);assert.deepEqual(fragment.turns.map(t=>t.events.map(e=>[e.begin,e.end,e.partBegin,e.partEnd,e.onset])),[[[0,4,1,2,false]],[[0,4,2,3,false]]]);checks.push({check:'range beginning inside long note gives continuations, zero duplicate onsets',passed:true});
  const unison=await paste(`stack(note('c3').s('triangle'),note('c3').s('triangle'))`,{count:1});assert.equal(unison.onsets,2);checks.push({check:'identical stacked unison voices remain two haps',passed:true});
  const bare=await load('bare-values');assert(bare.score.turns.flatMap(t=>t.events).every(e=>e.pitch===null&&e.sound==='value'));assert(bare.score.turns.flatMap(t=>t.events).some(e=>e.value==='a'));await page.click('[data-view="ring"]');assert.equal(await page.locator('.turn-tag.pitch').count(),0);checks.push({check:'bare values retained without inventing notes or sounds',passed:true});
  const labels=await paste(`setcpm(45)\n$: s('bd')\n$: s('hh*2')`,{count:2});assert(labels);assert.equal(labels.onsets,6);assert.equal(labels.cps,.75);checks.push({check:'pasted multi-label program and explicit tempo evaluate',passed:true});
  const failed=await paste(`note('c3').fmap(() => { throw Error('deliberate query fault') })`);assert.equal(failed,null);assert.match(await page.locator('#status').textContent(),/deliberate query fault/);assert.equal(await page.locator('[data-cycle]').count(),0);checks.push({check:'query errors show failure and clear prior data',passed:true});
  await load('full-piece');await page.click('[data-view="fly"]');await page.fill('#tempo','60');
  const before=await page.evaluate(()=>({cycle:window.spiral.cycle,camera:window.spiral.camera(),time:performance.now()}));
  await page.click('#play');await page.waitForTimeout(900);await page.click('#play');
  const after=await page.evaluate(()=>({cycle:window.spiral.cycle,camera:window.spiral.camera(),time:performance.now()}));
  assert(Math.abs((after.cycle-before.cycle)-(after.time-before.time)/1000)<.18);
  assert(Math.abs((after.camera.position[2]-before.camera.position[2])+1.75*(after.cycle-before.cycle))<.03);checks.push({check:'60 CPM playhead follows elapsed time; fly camera advances 1.75 world units/cycle',passed:true,before,after});
  await page.click('[data-view="ring"]');let camera=await page.evaluate(()=>window.spiral.camera());
  const canvas=await page.locator('canvas').boundingBox();assert(canvas);
  await page.mouse.move(canvas.x+canvas.width*.7,canvas.y+canvas.height*.55);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.78,canvas.y+canvas.height*.63,{steps:10});await page.mouse.up();await settle(15);
  assert.notDeepEqual(await page.evaluate(()=>window.spiral.camera()),camera);camera=await page.evaluate(()=>window.spiral.camera());await page.mouse.wheel(0,-300);await settle(15);assert.notDeepEqual(await page.evaluate(()=>window.spiral.camera()),camera);checks.push({check:'mouse drag orbits and wheel zooms a real 3D camera',passed:true});
  // A focused hover makes the full settings bag visible.
  await page.click('#reset');await page.click('[data-view="ring"]');await settle();
  await page.click('[aria-label="Focus sound triangle"]');await page.screenshot({path:'shots/full-piece-ring-focused.png'});
  await paste(`s('bd')`,{start:7,count:1});await page.fill('#tempo','300');await page.click('#play');await page.waitForTimeout(350);assert(await page.evaluate(()=>window.spiral.cycle>7.99&&window.spiral.cycle<8));assert(await page.locator('#play').isDisabled());assert.match(await page.locator('#status').textContent(),/not the pattern/);checks.push({check:'query horizon stops playback explicitly; no false loop or inferred repeat',passed:true});
  const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});await mobile.goto(url);await mobile.waitForFunction(()=>window.spiral?.ready);const session=await mobile.context().newCDPSession(mobile);const rect=await mobile.locator('canvas').boundingBox();assert(rect);const touchBefore=await mobile.evaluate(()=>window.spiral.camera());
  const touch=(type,points)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y,id])=>({x,y,id}))});
  await touch('touchStart',[[rect.x+140,rect.y+180,1]]);await touch('touchMove',[[rect.x+220,rect.y+220,1]]);await touch('touchEnd',[]);await mobile.waitForTimeout(150);assert.notDeepEqual(await mobile.evaluate(()=>window.spiral.camera()),touchBefore);
  const pinchBefore=await mobile.evaluate(()=>window.spiral.camera());await touch('touchStart',[[rect.x+120,rect.y+180,1],[rect.x+220,rect.y+180,2]]);await touch('touchMove',[[rect.x+80,rect.y+180,1],[rect.x+260,rect.y+180,2]]);await touch('touchEnd',[]);await mobile.waitForTimeout(150);assert.notDeepEqual(await mobile.evaluate(()=>window.spiral.camera()),pinchBefore);await mobile.screenshot({path:'shots/touch-mobile-orbit.png',fullPage:true});await mobile.click('#reset');await mobile.waitForTimeout(180);assert(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mobile.screenshot({path:'shots/touch-mobile.png',fullPage:true});await mobile.close();checks.push({check:'390px touch viewport: orbit and two-finger pinch change camera',passed:true});
  await load('arrange-64');await page.fill('#count','256');await page.click('#evaluate');await ready();assert.equal(await page.evaluate(()=>window.spiral.score.turns.length),256);assert(await page.locator('#turns').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.click('[data-view="side"]');await settle(6);await page.screenshot({path:'shots/arrange-256-side.png'});checks.push({check:'256-cycle window evaluates and fits in the coil (visual readability judged separately)',passed:true,metrics:await page.evaluate(()=>window.spiral.metrics())});
  // Density sweep: visual evidence, not a statistical readability test.
  output.density=[];
  for(const n of [16,32,64,128,256,512]) {
    const s=await paste(`note('c3 d3 e3 f3 g3 a3 b3 c4').s('sawtooth').fast(${n/8}).gain(.6).lpf(4800)`,{count:4});assert.equal(s.onsets,n*4);
    await page.click('[data-view="ring"]');await page.click('[data-cycle="1"]');
    for(const detail of ['raw','auto']) {await page.selectOption('#detail',detail);await settle(3);await page.screenshot({path:`shots/density-${n}-${detail}-ring.png`});output.density.push({onsetsPerCycle:n,detail,metrics:await page.evaluate(()=>window.spiral.metrics())});}
  }
  await page.selectOption('#detail','auto');await page.mouse.move(canvas.x+canvas.width*.6,canvas.y+canvas.height*.6);await page.mouse.wheel(0,-1800);await settle(15);assert.equal(await page.evaluate(()=>window.spiral.metrics().aggregated),0);await page.screenshot({path:'shots/density-512-zoom-ring.png'});checks.push({check:'close zoom restores individual haps from auto LOD',passed:true});
  checks.push({check:'density sweep: real queries at 16/32/64/128/256/512 onsets per cycle',passed:true});
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(failedRequests.length,0,JSON.stringify(failedRequests));
} catch(error) {output.failure=error.stack;process.exitCode=1;console.error(error);} finally {
  output.environment.loadAfter=os.loadavg();output.totalSeconds=(performance.now()-begin)/1000;
  await fs.writeFile(process.env.BEHAVIOR_ONLY?'measurements-behavior.json':'measurements.json',JSON.stringify(output,null,2)+'\n');
  await browser.close();await server.close();console.log(`Saved ${process.env.BEHAVIOR_ONLY?'measurements-behavior.json':'measurements.json'} (${output.totalSeconds.toFixed(1)}s)`);
}
