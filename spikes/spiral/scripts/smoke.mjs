import assert from 'node:assert/strict';
import {preview} from 'vite';
import {freePort} from './dev.mjs';
import {launchBrowser} from './browser.mjs';
const server=await preview({preview:{host:'127.0.0.1',port:await freePort(),strictPort:true}});
const address=server.httpServer.address();assert(address&&typeof address!=='string');
const browser=await launchBrowser();
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${address.port}`);await page.waitForFunction(()=>window.spiral?.ready);
  assert.equal(await page.evaluate(()=>window.spiral.score?.onsets),60);
  await page.selectOption('#program','full-piece');await page.waitForFunction(()=>window.spiral.ready);
  assert.equal(await page.evaluate(()=>window.spiral.score?.onsets),452);
  await page.click('[data-cycle="3"]');await page.screenshot({path:'shots/production-ring.png'});
  assert.deepEqual(errors,[]);console.log('PASS: built bundle, worker and local fonts load; real 60/452-onset queries.');
} finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
