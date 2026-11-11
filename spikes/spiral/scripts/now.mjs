import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {preview} from 'vite';
import {freePort} from './dev.mjs';
import {launchBrowser} from './browser.mjs';
const begin=performance.now();
const server=await preview({preview:{host:'127.0.0.1',port:await freePort(),strictPort:true}});
const address=server.httpServer.address();assert(address&&typeof address!=='string');
const browser=await launchBrowser();const errors=[],failures=[],checks=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))failures.push(r.url());});
 await page.goto(`http://127.0.0.1:${address.port}`);await page.waitForFunction(()=>window.spiral?.ready);
 async function paste(code){await page.fill('#source',code);await page.fill('#count','4');await page.click('#evaluate');await page.waitForFunction(()=>window.spiral.ready);}
 async function advance(to){await page.click('#play');await page.waitForFunction(to=>window.spiral.cycle>=to,to);await page.click('#play');}
 const voices=()=>page.locator('.now-tag .gate-voices i').allTextContents();
 await paste('setcpm(60)\nstack(note("c3 ~").s("triangle"),note("~ e3").s("sine"))');await page.click('[data-view="fly"]');
 await page.click('#play');
 const disagreements=await page.evaluate(async()=>{const result=[];for(let i=0;i<30;i++){await new Promise(requestAnimationFrame);const summary=document.querySelector('#now-cycle').textContent.match(/TURN (\d+) · ([\d.]+)/)?.slice(1),gate=document.querySelector('.now-tag b').textContent.match(/NOW · (\d+) \/ ([\d.]+)/)?.slice(1);if(JSON.stringify(summary)!==JSON.stringify(gate))result.push({summary,gate});}return result;});
 await page.click('#play');assert.deepEqual(disagreements,[],'The gate and turn readout must show the same score address in every frame');await page.click('[data-cycle="0"]');checks.push('Gate and secondary clock agree while travelling');
 await advance(.2);assert.deepEqual(await voices(),['triangle']);await advance(.4);assert.deepEqual(await voices(),['triangle']);await advance(.7);assert.deepEqual(await voices(),['sine']);checks.push('Active note remains named for its duration; next voice replaces it after the scored boundary');
 await paste('setcpm(60)\nnote("c3 ~").s("triangle")');await advance(.7);assert.equal(await page.locator('.gate-voices').textContent(),'Rest');checks.push('A real rest clears the sounding-voice readout');
 await paste('setcpm(60)\nnote("c3").s("triangle").slow(4)');await page.click('[data-cycle="1"]');assert.deepEqual(await voices(),['triangle']);checks.push('A cross-cycle continuation stays active without a duplicate onset');
 await page.selectOption('#program','full-piece');await page.waitForFunction(()=>window.spiral.ready);await page.click('[data-view="fly"]');
 assert.equal(await page.selectOption('#ahead','4').then(()=>page.evaluate(()=>window.spiral.metrics().cycles)),16);
 assert.match(await page.locator('#detail-note').textContent(),/5 turns/);await page.selectOption('#ahead','8');await page.waitForFunction(()=>document.querySelector('#detail-note').textContent.includes('9 turns'));checks.push('Four future turns by default; look-ahead control reveals eight');
 await page.click('[aria-label="Focus sound triangle"]');assert(await page.locator('.sound-key.solo').count()===1);assert.match(await page.locator('.sound-key.solo').textContent(),/triangle/);await page.waitForFunction(()=>[...document.querySelectorAll('.gate-voices i')].some(el=>getComputedStyle(el).opacity==='0.25'));checks.push('Voice focus preserves the other voices as ghosts');
 await page.click('#listen');await page.waitForFunction(()=>document.querySelector('#listen').textContent.includes('Pause audio'),{timeout:20000});const a=await page.evaluate(()=>window.spiral.cycle);await page.waitForFunction(a=>window.spiral.cycle>a+.15,a);await page.click('#listen');const stopped=await page.evaluate(()=>window.spiral.cycle);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.spiral.cycle),stopped);checks.push('User-gesture audio starts the playhead, and Pause audio holds it');
 await page.selectOption('#program','signals');await page.waitForFunction(()=>window.spiral.ready);await advance(.2);assert(await page.evaluate(()=>window.spiral.score.signalSamples>0));await page.screenshot({path:'shots/v2/signals-after.png'});checks.push('Continuous lane query and current-value beads rendered (screenshot judged separately)');
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
 console.log('PASS',checks);
}finally{const result={totalSeconds:(performance.now()-begin)/1000,checks,errors,failures,browser:browser.version(),server:'built Vite preview, OS-selected port',heard:'No listening judgment'};await fs.writeFile('study02-checks.json',JSON.stringify(result,null,2));console.log('Duration',result.totalSeconds);await browser.close();await server.close();}
