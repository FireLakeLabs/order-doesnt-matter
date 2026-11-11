import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,extname,join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
const here=import.meta.dirname;process.chdir(here);
if(!process.argv.includes('--no-build'))execFileSync(process.execPath,['build.mjs'],{stdio:'inherit'});
await mkdir('raw',{recursive:true});await mkdir('out',{recursive:true});
const server=createServer(async(req,res)=>{try{let p=decodeURIComponent(new URL(req.url,'http://local').pathname);if(p==='/favicon.ico'){res.writeHead(204);res.end();return;}if(p.endsWith('/'))p+='index.html';if(p.startsWith('/fonts/'))p='/rooms'+p;const file=resolve(here,'built','.'+p);if(!file.startsWith(resolve(here,'built')+'/'))throw Error('bad path');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[extname(file)]||'application/octet-stream'));res.end(await readFile(file));}catch{res.writeHead(404);res.end('missing');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const cache=join(homedir(),'.cache/ms-playwright');const executablePath=process.env.CHROMIUM_PATH||(await readdir(cache)).filter(x=>/^chromium-\d+$/.test(x)).sort((a,b)=>+b.split('-')[1]-+a.split('-')[1]).map(x=>join(cache,x,'chrome-linux64/chrome')).find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader']});
let page,meta;
const wait=ms=>page.waitForTimeout(ms);
const cap=(title,text,note)=>page.evaluate(([a,b,c])=>window.demo.caption(a,b,c),[title,text,note]);
async function take(id,kind,fn){
 const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:resolve('raw/videos'),size:{width:1280,height:720}}});page=await context.newPage();meta={id,kind,errors:[],failedResponses:[],browser:browser.version(),events:[]};
 page.on('response',r=>{if(r.status()>=400)meta.failedResponses.push({status:r.status(),url:r.url()});});page.on('pageerror',e=>meta.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')meta.errors.push(m.text().slice(0,400));});
 try{await page.goto(`http://127.0.0.1:${port}/${kind}/`);await page.waitForFunction(()=>window.demoReady,{timeout:30000});if(kind==='gesture')await page.waitForFunction(()=>window.gesture?.events?.length);if(kind==='spiral')await page.waitForFunction(()=>window.spiral?.ready&&window.spiral?.score);if(kind==='rooms')await page.waitForFunction(()=>window.roomUI);
 await wait(250);await cap('SYNC CHECK','White flash + short click. Music starts next.');await page.evaluate(()=>window.demo.marker());await wait(650);
 await fn();
 if(kind==='gesture')await page.evaluate(()=>window.gesture.engine.stop());else if(kind==='spiral')await page.evaluate(()=>{window.demo.stop();window.demo.web.resetGlobalEffects();});else await page.evaluate(()=>document.querySelector('#stop').click());
 await cap('END SYNC CHECK','White flash + short click. End of this take.');await wait(650);await page.evaluate(()=>window.demo.marker());await wait(700);
 const audio=await page.evaluate(()=>window.demo.export());await writeFile(`raw/${id}.f32`,Buffer.from(audio.base64,'base64'));delete audio.base64;Object.assign(meta,audio);
 if(kind==='gesture')meta.gesture=await page.evaluate(()=>({samples:window.gesture.engine.samples,triggers:window.gesture.engine.triggers,error:window.gesture.error}));if(kind==='spiral')meta.renderMetrics=await page.evaluate(()=>window.spiral.metrics());
 await page.screenshot({path:`raw/${id}-check.png`});const video=page.video();await context.close();await video.saveAs(resolve(`raw/${id}.webm`));await writeFile(`raw/${id}.json`,JSON.stringify(meta,null,2));console.log('RECORDED',id,'errors',meta.errors);
 }catch(e){await page.screenshot({path:`raw/${id}-FAILED.png`}).catch(()=>{});await writeFile(`raw/${id}-failure.json`,JSON.stringify({...meta,error:String(e)},null,2));await context.close();throw e;}
}
async function xy(phase,radius){return page.evaluate(([phase,radius])=>{const b=document.querySelector('#score').getBoundingClientRect(),a=phase*2*Math.PI-Math.PI/2;return {x:b.x+(270+Math.cos(a)*radius)*b.width/1040,y:b.y+(290+Math.sin(a)*radius)*b.height/580};},[phase,radius]);}
async function down(p,r){const q=await xy(p,r);await page.mouse.move(q.x,q.y);await page.mouse.down();}
async function move(p,r){const q=await xy(p,r);await page.mouse.move(q.x,q.y);}
async function shape(rest=false){return page.evaluate(rest=>window.gesture.shapes.find(s=>s.voice==='melody'&&s.path.join('.')==='0'&&s.role===(rest?'rest':'note')),rest);}
async function gesture(title,instruction,action){
 await cap(title,instruction);await wait(650);
 const start=await page.evaluate(()=>{const g=window.gesture;window.demoBefore=g.engine.repl.state.pattern;return {rev:g.engine.revision+1,audio:window.demo.ac.currentTime,performance:performance.now(),horizon:g.engine.repl.scheduler.lastEnd};});
 await action();await wait(2200);
 const measurement=await page.evaluate(start=>{
  const g=window.gesture,ac=window.demo.ac,release=window.demo.releases.at(-1),old=window.demoBefore,s=g.engine.repl.scheduler;
  const revised=g.engine.triggers.filter(t=>t.revision>=start.rev&&t.voice==='melody').sort((a,b)=>a.target-b.target);
  const same=(t,h)=>Math.abs(Number(h.whole.begin)-t.begin)<1e-7&&['note','cutoff','gain','ghost'].every(k=>JSON.stringify(h.value[k])===JSON.stringify(t.value[k]));
  let changed=revised.find(t=>!old.queryArc(t.begin-1e-7,t.begin+1e-7).filter(h=>h.hasOnset()).some(h=>same(t,h)));
  let target=changed?.target,type='first changed scheduled note';
  // A rest has no trigger. Locate the first old scored onset beyond the committed horizon
  // that is absent from the new score, and check it was absent from actual dispatches.
  const current=g.engine.repl.state.pattern;
  const removed=old.queryArc(start.horizon,start.horizon+3).filter(h=>h.hasOnset()&&h.value.voice==='melody').find(h=>{const b=Number(h.whole.begin);return !current.queryArc(b-1e-7,b+1e-7).filter(x=>x.hasOnset()).some(x=>Math.abs(Number(x.whole.begin)-b)<1e-7&&x.value.voice==='melody')&&!g.engine.triggers.some(t=>t.voice==='melody'&&Math.abs(t.begin-b)<1e-7);});
  if(removed){const b=Number(removed.whole.begin),at=s.seconds_at_cps_change+(b-s.num_cycles_at_cps_change)/s.cps+s.latency;if(target===undefined||at<target){target=at;type='first removed onset (gap)';}}
  return {start,release,target,type,delayMs:target===undefined?null:1000*(target-release.audio),revision:changed?.revision,changed,swapMs:g.engine.samples.filter(x=>x.revision>=start.rev).map(x=>x.latency)};
 },start);
 meta.events.push({title,instruction,...measurement});console.log(title,measurement.delayMs);
 await cap(title,measurement.delayMs===null?'No affected onset was identified — do not infer a delay.':`Release → ${measurement.type}: ${Math.round(measurement.delayMs)} ms`, 'Measured engine target, not a speaker measurement · yellow tick = release');await wait(1650);
}
async function gestureTake(){
 await cap('1 · Gesture delay','One gesture at a time. Compare release ticks with the music.');await page.evaluate(()=>document.querySelector('#play').click());await wait(1400);
 await gesture('Turn the ring by 1/8','Watch the note positions rotate. Listen after the yellow release tick.',async()=>{await down(0,67);await move(.125,67);await page.mouse.up();});
 await gesture('Lift one note','The first note moves outward by six semitones.',async()=>{const s=await shape();await down((s.begin+s.end)/2,s.radius);await move((s.begin+s.end)/2,s.radius+30);await page.mouse.up();});
 await gesture('Tap that note to a rest','The dashed mark stays touchable. Listen for the missing onset.',async()=>{const s=await shape();await down((s.begin+s.end)/2,s.radius);await page.mouse.up();});
 await gesture('Tap the rest back to a note','Watch the solid arc return. Listen for its next onset.',async()=>{const s=await shape(true);await down((s.begin+s.end)/2,s.radius);await page.mouse.up();});
 await gesture('Paint the brightness ring','Only the painted part changes. Compare its next notes.',async()=>{await down(0,160);for(let i=1;i<=8;i++)await move(i/16,170);await page.mouse.up();});
 await gesture('Double the speed','Two fingers spread: the melody becomes two turns per cycle.',async()=>{const cdp=await page.context().newCDPSession(page),a=await xy(.75,55),b=await xy(.25,55),c=await xy(.75,100),d=await xy(.25,100);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,id:1},{...b,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...c,id:1},{...d,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();});
 await gesture('Pull an echo','The ghost ring shows the extra, shifted notes.',async()=>{await page.locator('[data-tool="echo"]').click();await down(0,67);await move(.25,115);await page.mouse.up();});
 await wait(600);
}
async function dragging(){
 await cap('3 · Continuous dragging','Slow turn first. Then fast scrubbing. Watch for uneven onsets.');await page.locator('#free').check();await page.evaluate(()=>document.querySelector('#play').click());await wait(1600);
 const begin=await page.evaluate(()=>window.demo.ac.currentTime);meta.segments=[];
 for(const [name,seconds,fast]of[['Slow continuous turn',8,false],['Fast back-and-forth scrubbing',8,true]]){
  await cap(name,'Every pointer move swaps the live pattern; the audio clock keeps running.');await down(0,67);const start=performance.now();let i=0;
  while(performance.now()-start<seconds*1000){const t=(performance.now()-start)/1000;await move(fast?.35*Math.sin(t*10):t/16,67);await wait(18);if(++i%20===0){const stats=await page.evaluate(()=>{const t=window.gesture.engine.triggers.filter(x=>x.voice==='melody').sort((a,b)=>a.target-b.target);let dup=0,compressed=0,late=0;for(let i=0;i<t.length;i++){if(t[i].target<t[i].audioNow)late++;if(i){const gap=t[i].target-t[i-1].target;if(Math.abs(gap)<.0001)dup++;else if(gap<.124)compressed++;}}return {dup,compressed,late};});await cap(name,`Logs so far: ${stats.compressed} gaps <125 ms · ${stats.dup} simultaneous onsets · ${stats.late} late`,'Dropped notes cannot be inferred during a changing score · inspect the recorded rhythm');}}
  await page.mouse.up();meta.segments.push({name,end:await page.evaluate(()=>window.demo.ac.currentTime)});await wait(1400);
 }
 await cap('What the logs can establish','Short gaps and simultaneous onsets are flagged; the changing score has no fixed “missing note” list.');await wait(3800);meta.dragStart=begin;
}
async function spiralProgram(id){await page.selectOption('#program',id,{force:true});await page.waitForFunction(id=>window.spiral.ready&&document.querySelector('#program').value===id&&window.spiral.score, id);const source=await page.inputValue('#source');await page.evaluate(source=>window.demo.play(source),source);meta.source=source;}
async function views(id,title){await spiralProgram(id);for(const [view,name]of[['ring','Ring focus'],['fly','Fly-through'],['side','Cycle coil']]){await page.locator(`[data-view="${view}"]`).click();await cap(`${title} · ${name}`,'Follow the sweep and the onsets. Each view uses the same playing score.',id==='full-piece'?'Six original voices · bd/sd/hh use generated local percussion samples · audio-clock playhead':'Original three-cycle alternation · audio-clock playhead · no speed change');meta.events.push({view,audio:await page.evaluate(()=>window.demo.ac.currentTime)});await wait(12000);}}
async function density(){await spiralProgram('density-64');await page.selectOption('#detail','raw',{force:true});await cap('5 · Density: individual notes','512 onsets per cycle. Individual arcs crowd together.','Original dense program · 512-polyphony recording allowance · audio-clock playhead');await wait(7500);meta.rawDensity=await page.evaluate(()=>window.spiral.metrics());await page.selectOption('#detail','auto',{force:true});await cap('Density: aggregated occupancy','Time bins combine notes. Exact onset positions are lost.');await wait(7500);meta.aggregateDensity=await page.evaluate(()=>window.spiral.metrics());const b=await page.locator('#stage canvas').boundingBox();await page.mouse.move(b.x+b.width*.55,b.y+b.height*.55);for(let i=0;i<10;i++){await page.mouse.wheel(0,-160);await wait(200);}await cap('Density: zoom in','Close zoom restores individual notes. Compare clarity with occupancy.');await wait(8500);meta.zoomDensity=await page.evaluate(()=>window.spiral.metrics());if(meta.rawDensity.aggregated!==0||meta.aggregateDensity.aggregated<=0||meta.zoomDensity.aggregated!==0)throw Error('Density stages did not resolve raw → aggregate → raw at zoom');}
const phrase='note("c3 e3 g3 b3").s("sawtooth").sustain(.6).release(.05)';
async function order(){
 await page.evaluate(()=>{const e=document.createElement('pre');e.className='demo-code';document.body.append(e);});
 const cases=[['Scalar setters · A','.lpf(800).gain(.5)'],['Scalar setters · B','.gain(.5).lpf(800)'],['Ordered FX · A','.gain(.5).FX(lpf(800).gain(1),distort(2).gain(1))'],['Ordered FX · B','.gain(.5).FX(distort(2).gain(1),lpf(800).gain(1))'],['Implicit lfo target · A','.lpf(800).gain(.5).lfo({rate:4,depth:.8})'],['Implicit lfo target · B','.gain(.5).lpf(800).lfo({rate:4,depth:.8})']];
 for(let i=0;i<cases.length;i++){const [name,suffix]=cases[i],code='setcps(.5)\n'+phrase+suffix;await page.evaluate(([code,suffix])=>{document.querySelector('textarea').value=code;document.querySelector('.demo-code').textContent='Same phrase: c3 e3 g3 b3 · sawtooth\n'+suffix;},[code,suffix]);await page.evaluate(()=>document.querySelector('#play').click());await page.waitForFunction(()=>window.roomUI.playing&&document.querySelector('#error').textContent==='');await cap(`6 · ${name}`,i<2?'Compare A with B. Independent scalar setters have equal event bags.':i<4?'Compare the two insert orders. Earlier probes measured different PCM.':'The lfo attaches to the setting just before it. Compare gain with cutoff.', 'No listening judgment made · each example starts the same phrase anew');meta.events.push({name,code,audio:await page.evaluate(()=>window.demo.ac.currentTime)});await wait(6200);await page.evaluate(()=>document.querySelector('#stop').click());await wait(250);}
}
async function rooms(){
 const code=orbit=>`setcps(.7)\nMINT: note("c4 ~ ~ ~").s("sine").gain(.4).release(.15).delay(.7).delaytime(.2).delayfeedback(.65).room(.8).roomsize(1.2).orbit(1)\nAMBER: note("~ ~ g4 ~").s("triangle").gain(.25).release(.15).delay(.4).delaytime(.07).delayfeedback(.35).room(.5).roomsize(.35).orbit(${orbit})`;
 for(const [orbit,title]of[[1,'A · One shared room'],[2,'B · Two separate rooms']]){await page.evaluate(code=>document.querySelector('textarea').value=code,code(orbit));await page.evaluate(()=>document.querySelector('#play').click());await page.waitForFunction(()=>window.roomUI.playing&&document.querySelector('#error').textContent==='');await cap(`7 · ${title}`,orbit===1?'Two senders disagree about delay and reverb. Watch the CONFLICT marker.':'Same phrases and settings; only AMBER’s room changes. Compare the tails.','The room display reports scheduling state; reverb buffers can finish asynchronously');await wait(12000);await page.screenshot({path:`raw/07-rooms-${orbit}.png`});meta.events.push({orbit,code:code(orbit),conflicts:await page.locator('.conflict').count(),rooms:await page.locator('.room').count()});await page.evaluate(()=>document.querySelector('#stop').click());await wait(450);}
}
const jobs=[['01-gesture-delay','gesture',gestureTake],['03-continuous-dragging','gesture',dragging],['04a-six-voice-views','spiral',()=>views('full-piece','4a · Six-voice piece')],['04b-three-cycle-views','spiral',()=>views('alternation','4b · Three-cycle pattern')],['05-density','spiral',density],['06-order-doesnt-matter','rooms',order],['07-rooms-fighting','rooms',rooms]];
try{for(const [id,kind,fn]of jobs){if(process.env.FROM&&id.slice(0,2)<process.env.FROM)continue;if(process.env.TAKE&&!id.startsWith(process.env.TAKE))continue;if(process.env.SKIP&&id.startsWith(process.env.SKIP))continue;await take(id,kind,fn);}}finally{await browser.close();await new Promise(r=>server.close(r));}
