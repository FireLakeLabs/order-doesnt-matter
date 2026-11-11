import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,extname,join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
const here=import.meta.dirname;process.chdir(here);
if(!process.argv.includes('--no-build'))execFileSync(process.execPath,['build-now.mjs'],{stdio:'inherit'});
await mkdir('raw',{recursive:true});await mkdir('out',{recursive:true});
const server=createServer(async(req,res)=>{try{let p=decodeURIComponent(new URL(req.url,'http://local').pathname);if(p==='/favicon.ico'){res.writeHead(204);res.end();return;}p=p.replace(/^\/spiral\//,'/');if(p.endsWith('/'))p+='index.html';const file=resolve(here,'built/spiral-now','.'+p);if(!file.startsWith(resolve(here,'built/spiral-now')+'/'))throw Error('bad path');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[extname(file)]||'application/octet-stream'));res.end(await readFile(file));}catch{res.writeHead(404);res.end('missing');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const cache=join(homedir(),'.cache/ms-playwright');const executablePath=process.env.CHROMIUM_PATH||(await readdir(cache)).filter(x=>/^chromium-\d+$/.test(x)).sort((a,b)=>+b.split('-')[1]-+a.split('-')[1]).map(x=>join(cache,x,'chrome-linux64/chrome')).find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:resolve('raw/videos'),size:{width:1280,height:720}}}),page=await context.newPage();
const id='08-spiral-now',meta={id,kind:'spiral',errors:[],failedResponses:[],events:[],browser:browser.version()};
page.on('response',r=>{if(r.status()>=400)meta.failedResponses.push({url:r.url(),status:r.status()});});page.on('pageerror',e=>meta.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')meta.errors.push(m.text().slice(0,400));});
const cap=(title,text,note='Same scored spans · audio-clock playhead · local bd / sd / hh percussion')=>page.evaluate(([a,b,c])=>window.demo.caption(a,b,c),[title,text,note]);
async function load(id){await page.selectOption('#program',id,{force:true});await page.waitForFunction(()=>window.spiral.ready&&window.spiral.score);await page.click('[data-view="fly"]');}
async function play(){await page.click('#listen');await page.waitForFunction(()=>document.querySelector('#listen').textContent.includes('Pause audio'));}
async function event(name){meta.events.push(await page.evaluate(name=>({name,audio:window.demo.ac.currentTime,cycle:window.spiral.cycle}),name));}
// Stage lengths use the output audio clock, so control/query time cannot stretch a chapter.
async function until(time){await page.waitForFunction(t=>window.demo.ac.currentTime>=t,time,{timeout:30000});}
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/spiral/`);await page.waitForFunction(()=>window.demoReady&&window.spiral?.ready,{timeout:30000});
 await load('full-piece');await page.evaluate(()=>window.demoSpiral.legacy(true));
 await cap('SYNC CHECK','White flash + short click. The score begins next.');await page.evaluate(()=>window.demo.marker());await page.waitForTimeout(500);
 await cap('BEFORE · Where is now?','Six voices, fourteen turns. The present gets lost in the tunnel.');await play();await event('old six-voice fly-through');
 const start=meta.events[0].audio;await until(start+8);
 await page.evaluate(()=>window.demoSpiral.legacy(false));await cap('AFTER · Follow the light','Bright rim = this turn. The gate names the voices active now.');await event('new six-voice fly-through');
 await until(start+18);await cap('Notes stay lit for their scored span','White beads mark now; past notes fade. Four turns lead into the phrase.');
 await until(start+28);await load('alternation');await cap('Three-cycle garden','The bass changes each turn. The gate stays unmistakable.','Original three-cycle pattern · no speed change · scored activity, not effect tails');await play();await event('three-cycle pattern');
 const three=meta.events.at(-1).audio;await until(three+8);
 await load('full-piece');await page.click('[aria-label="Focus sound triangle"]');await cap('Focus a voice · keep the ensemble','Triangle stays in colour. Other voices become ghosts.','Visual focus only · all six voices still play · local percussion substitutes');await play();await event('triangle focus, six voices');
 const focus=meta.events.at(-1).audio;await until(focus+7);await page.evaluate(()=>window.demo.stop());await event('music stopped');
 await cap('END SYNC CHECK','White flash + short click. End of this take.','A/V sync measured from decoded output · no listening judgment');await page.waitForTimeout(350);await page.evaluate(()=>window.demo.marker());await page.waitForTimeout(650);
 const audio=await page.evaluate(()=>window.demo.export());await writeFile(`raw/${id}.f32`,Buffer.from(audio.base64,'base64'));delete audio.base64;Object.assign(meta,audio);meta.renderMetrics=await page.evaluate(()=>window.spiral.metrics());
 await page.screenshot({path:`raw/${id}-check.png`});const video=page.video();await context.close();await video.saveAs(resolve(`raw/${id}.webm`));await writeFile(`raw/${id}.json`,JSON.stringify(meta,null,2));console.log('RECORDED',id,JSON.stringify(meta.events),'errors',meta.errors);
 if(meta.errors.length||meta.failedResponses.length)throw Error('Capture had browser errors or failed responses');
}catch(error){await page.screenshot({path:`raw/${id}-FAILED.png`}).catch(()=>{});await writeFile(`raw/${id}-failure.json`,JSON.stringify({...meta,error:String(error)},null,2));throw error;
}finally{await browser.close();await new Promise(r=>server.close(r));}
