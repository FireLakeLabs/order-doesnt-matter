import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import {extname,join} from 'node:path';
import {chromium} from '@playwright/test';
const root=new URL('./dist/',import.meta.url).pathname;
const server=createServer(async(req,res)=>{try{const p=join(root,new URL(req.url,'http://localhost').pathname);const file=await readFile(p.endsWith('/')?p+'index.html':p);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[extname(p)]||'text/html'));res.end(file);}catch{res.statusCode=404;res.end('missing');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
let executablePath=process.env.CHROMIUM_PATH;
if(!executablePath&&!existsSync(chromium.executablePath())){const cache=join(os.homedir(),'.cache/ms-playwright');const dirs=await readdir(cache);executablePath=dirs.filter(d=>/^chromium-\d+$/.test(d)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1])).map(d=>join(cache,d,'chrome-linux64/chrome')).find(existsSync);}
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1040}});
 page.on('pageerror',e=>console.error('PAGE',e.message));
 page.on('console',msg=>{if(msg.type()==='warning'||msg.type()==='error')console.error(msg.text().slice(0,300));});
 await page.goto(`http://127.0.0.1:${port}`);
 await page.waitForFunction(()=>window.probe?.ready,{timeout:30000});
 if(process.argv.includes('--shots')){
  await mkdir('shots',{recursive:true});const checks=[];
  for(let i=0;i<5;i++){
    await page.selectOption('select',String(i));const before=await page.evaluate(()=>window.roomUI.noteCount);
    await page.click('#play');await page.waitForFunction(()=>window.roomUI?.playing);await page.waitForTimeout(950);
    const state=await page.evaluate(()=>({notes:window.roomUI.noteCount,errors:document.querySelector('#error').textContent,rooms:document.querySelectorAll('.room').length,conflicts:document.querySelectorAll('.conflict').length,inserts:document.querySelectorAll('.fx').length,relationships:document.querySelector('#relations').textContent}));
    assert(state.notes>before);assert.equal(state.errors,'');if(i===1)assert.equal(state.inserts,2);if(i===2)assert.equal(state.conflicts,1);if(i===3)assert.equal(state.rooms,2);if(i===4){assert.match(state.relationships,/ducks/);assert.match(state.relationships,/CUT 3/);}
    checks.push({example:i+1,...state});await page.screenshot({path:`shots/${i+1}.png`,fullPage:true});await page.click('#stop');
  }
  await page.locator('textarea').fill('note(');await page.click('#play');await page.waitForFunction(()=>document.querySelector('#error').textContent.length>0);
  await page.locator('textarea').fill('s("local").fit().orbit(3)');await page.click('#play');await page.waitForFunction(()=>window.roomUI.playing&&document.querySelector('#error').textContent==='');
  await page.waitForTimeout(500);await page.click('#stop');
  await page.setViewportSize({width:390,height:844});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  await writeFile('ui-results.json',JSON.stringify({checks,errorRecovery:true,pastedLocalSample:true,mobileNoHorizontalOverflow:true},null,2));
 }
 else {const results=await page.evaluate(async()=>window.probe.measure());await writeFile('results.json',JSON.stringify({browser:await browser.version(),...results},null,2));console.log(`Saved ${results.experiments.length} minimal-pair comparisons, ${results.lengths.length} length probes and ${results.samples.length} sample probes.`);}
}finally{await browser.close();await new Promise(r=>server.close(r));}
