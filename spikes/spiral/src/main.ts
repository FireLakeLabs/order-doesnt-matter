import './style.css';
import {startAudio,stopAudio,audioCycle,setAudioTempo} from './audio';
import { programs } from './programs';
import { SpiralScene,colourFor } from './scene';
import type { Metrics, QueryReply, Score, ScoreEvent, View } from './types';

const app=document.querySelector<HTMLDivElement>('#app');
if(!app)throw Error('Missing app root');
app.innerHTML=`
<header><div class="brand"><i>◉</i> Order Doesn't Matter</div><div class="header-right"><span class="eyebrow">A score, seen differently</span><span class="badge">Spiral study / 02</span></div></header>
<main class="workspace">
  <aside class="sidebar">
    <div><div class="eyebrow">An instrument for looking</div><h1>Time,<br>in orbit.</h1><p class="intro">One turn is one cycle.<br>Step inside the shape of a score.</p></div>
    <div><label class="section-label" for="program">Stress score <span id="rows"></span></label><select id="program" aria-label="Stress program"></select></div>
    <div><label class="section-label" for="source">Strudel source <span>editable</span></label><textarea id="source" spellcheck="false" aria-label="Strudel source"></textarea><div class="eval-row"><small>⌘ / Ctrl + Enter</small><button class="primary" id="evaluate">Draw score ↗</button></div></div>
    <div><div class="fields"><label>FROM CYCLE<input id="start" type="number" min="0" value="0" aria-label="Start cycle"></label><label>QUERY CYCLES<input id="count" type="number" min="1" max="256" value="12" aria-label="Query cycles"></label></div><p id="status" role="status" style="margin-top:12px">Querying the score…</p></div>
    <div class="legend"><div class="section-label">Reading the orbit</div><p><i class="key"></i>Creature · length = score duration</p><p><i class="key lane"></i>Band · signal, without an onset</p><p><i class="key changed"></i>Amber seam · changed from prior turn</p><p style="margin-top:12px">Radius → pitch / drum lane<br>Width → gain · light → cutoff<br>Colour → sound · dots → continuation</p></div>
  </aside>
  <section class="stage-wrap">
    <div class="toolbar"><nav class="views" aria-label="Score view"><button data-view="fly">↗ Fly-through</button><button data-view="ring" class="active">◎ Ring focus</button><button data-view="side">≋ Cycle coil</button></nav><div class="transport"><label for="tempo">CPM</label><input id="tempo" type="number" min="1" max="300" value="30" aria-label="Cycles per minute"><button id="reset" aria-label="Reset camera" title="Reset camera">⌖</button><button id="play" title="Silent camera travel">▶ Travel</button><button id="listen">▶ Play audio</button></div></div>
    <div class="stage" id="stage"><div class="hud"><div class="eyebrow" id="view-kicker">The present, in detail</div><strong id="view-title">One cycle. Room to read.</strong><p id="view-description">Previous and next turns are ghosted. The bright sweep moves at the score's tempo.</p></div><div class="readout"><div><strong id="fps">—</strong>FPS</div><div><strong id="event-count">—</strong>ONSETS</div><div><strong id="query-time">—</strong>QUERY ms</div></div><div id="turn-labels" class="turn-labels"></div><div id="now-readout" class="now-readout"><span class="eyebrow">AT THE GATE · SCORED NOW</span><strong id="now-cycle"></strong><div id="now-voices"></div><small id="audio-state">Silent · press Play audio</small></div><div class="center-label" id="center-label">CYCLE<b id="cycle-label">00</b><small id="phase-label">0.00 / 1.00</small></div><div class="sounds" id="sounds"></div><div class="stage-footer"><span>Orbit camera · scroll / pinch to zoom · hover to read</span><span id="detail-note"></span></div><div class="tooltip" id="tooltip" hidden></div></div>
    <div class="hint-row"><p id="program-hint"></p><label class="ahead-label">LOOK AHEAD <select id="ahead" aria-label="Turns ahead"><option value="3">3 turns</option><option value="4" selected>4 turns</option><option value="5">5 turns</option><option value="8">8 turns</option><option value="14">14 turns</option></select></label><select id="detail" aria-label="Event detail"><option value="auto">Auto detail</option><option value="raw">Raw creatures</option></select></div>
    <div class="timeline"><div class="timeline-top"><span>THE QUERIED HORIZON <span id="horizon"></span></span><span><span style="color:#efbd75">Δ</span> changed · click a cycle to visit</span></div><div class="turns" id="turns"></div><div class="timeline-labels"><span id="range-start">00</span><span id="range-mid"></span><span id="range-end"></span></div></div>
  </section>
</main>`;
function get<T extends HTMLElement>(selector:string):T {const el=document.querySelector<T>(selector);if(!el)throw Error(`Missing ${selector}`);return el;}
const program=get<HTMLSelectElement>('#program'),source=get<HTMLTextAreaElement>('#source'),start=get<HTMLInputElement>('#start'),count=get<HTMLInputElement>('#count'),status=get('#status'),play=get<HTMLButtonElement>('#play'),tempo=get<HTMLInputElement>('#tempo');
const tooltip=get('#tooltip');
const scene=new SpiralScene(get('#stage'),get('#turn-labels'),(event,x,y,cell)=>{
  tooltip.hidden=!event;if(!event)return;
  tooltip.textContent=`${cell?`OCCUPANCY · ${cell.count} queried parts\nbin ${cell.begin.toFixed(4)} → ${cell.end.toFixed(4)}\nExample real hap:\n`:''}${event.sound} · ${event.onset?'onset':'continuation'}\nwhole ${event.begin.toFixed(4)} → ${event.end.toFixed(4)}\npart  ${event.partBegin.toFixed(4)} → ${event.partEnd.toFixed(4)}\n${JSON.stringify(event.value,null,2)}`;
  tooltip.style.left=`${Math.min(x+14,get('#stage').clientWidth-285)}px`;tooltip.style.top=`${Math.max(90,Math.min(y,get('#stage').clientHeight-275))}px`;
});
let score:Score|null=null,worker:Worker|null=null,generation=0,cycle=0,playing=false,last=performance.now();
let frames:number[]=[],draws:number[]=[];let ready=false;let lastHud=0;let listening=false,audioGeneration=0;
const descriptions:Record<View,[string,string,string]>={
  fly:['The present has a place','Follow the light.','Bright rim = this turn. White gate = now. Coloured spans stay lit for their scored duration.'],
  ring:['The present, in detail','One cycle. Room to read.','Previous and next turns are ghosted. The bright sweep moves at the score’s tempo.'],
  side:['The shape of a phrase','Every turn has a different story.','A coiled timeline. Amber marks changes, never an inferred repeat. Use the strip to find a turn.'],
};
function setView(view:View) {
  scene.setView(view);frames=[];draws=[];
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
  const d=descriptions[view];get('#view-kicker').textContent=d[0];get('#view-title').textContent=d[1];get('#view-description').textContent=d[2];get('#center-label').hidden=true;get('#stage').dataset.view=view;
}
function focus(value:number) {silence();playing=false;play.disabled=false;play.textContent='▶ Travel';cycle=value;scene.setFocus(value);frames=[];draws=[];updateCurrent();}
function silence(){audioGeneration++;listening=false;stopAudio();get<HTMLButtonElement>('#listen').disabled=false;get('#listen').textContent='▶ Play audio';get('#audio-state').textContent='Silent · press Play audio';}
function updateNowAddress(){get('#now-cycle').textContent=`TURN ${String(Math.floor(cycle)).padStart(2,'0')} · ${(cycle%1).toFixed(2)}`;}
function updateCurrent() {
  updateNowAddress();
  const current=score?.turns.find(t=>t.cycle===Math.floor(cycle));
  const active=[...new Set(current?.events.filter(e=>e.begin<=cycle&&cycle<e.end).map(e=>e.sound)??[])];
  get('#now-voices').replaceChildren(...active.map(sound=>{const span=document.createElement('span');span.style.color=colourFor(sound);span.textContent=sound;span.className=scene.solo&&scene.solo!==sound?'ghost':'';return span;}));
  if(!active.length)get('#now-voices').textContent=score?'Rest · no scored notes':'No score';

  get('#cycle-label').textContent=String(Math.floor(cycle)).padStart(2,'0');get('#phase-label').textContent=`${(cycle%1).toFixed(2)} / 1.00`;
  document.querySelectorAll<HTMLButtonElement>('[data-cycle]').forEach(b=>b.classList.toggle('current',Number(b.dataset.cycle)===Math.floor(cycle)));
}
async function evaluate():Promise<boolean> {
  silence();const id=++generation;worker?.terminate();ready=false;playing=false;play.disabled=false;play.textContent='▶ Travel';
  status.className='';status.textContent='Asking Strudel about time…';get('#stage').classList.add('loading');
  worker=new Worker(new URL('./query.worker.ts',import.meta.url),{type:'module'});
  const active=worker;
  return new Promise(resolve=>{
    const finishError=(message:string)=>{if(id!==generation)return;active.terminate();ready=true;score=null;scene.score=null;scene.rebuild();status.className='error';status.textContent=`Query failed · ${message}`;get('#event-count').textContent='ERROR';get('#turns').replaceChildren();get('#sounds').replaceChildren();get('#query-time').textContent='—';get('#horizon').textContent=' / QUERY FAILED';get('#stage').classList.remove('loading');resolve(false);};
    const timeout=setTimeout(()=>finishError('Evaluation exceeded 8 seconds. Reduce the window or simplify the program.'),8000);
    active.onerror=event=>{clearTimeout(timeout);finishError(event.message);};
    active.onmessage=(event:MessageEvent<QueryReply>)=>{
      clearTimeout(timeout);if(id!==generation){resolve(false);return;}
      active.terminate();const result=event.data;
      if(!result.ok){finishError(result.error);return;}
      score=result.score;ready=true;cycle=score.turns[0]?.cycle??0;tempo.value=String(+(score.cps*60).toFixed(3));
      scene.setSolo(null);scene.setScore(score);frames=[];draws=[];get('#stage').classList.remove('loading');
      get('#event-count').textContent=score.onsets.toLocaleString();get('#query-time').textContent=score.queryMs.toFixed(0);
      status.textContent=`${score.turns.length} cycles · ${score.onsets.toLocaleString()} onsets · ${score.fragments} continuations${score.signalSamples?` · ${score.signalSamples} signal samples`:''}. ${score.warnings.join(' ')}`;
      get('#horizon').textContent=` / ${score.turns.length} CYCLES`;
      get('#turns').style.gap=score.turns.length>128?'1px':'3px';
      const max=Math.max(1,...score.turns.map(t=>t.onsets));
      get('#turns').innerHTML=score.turns.map(t=>`<button data-cycle="${t.cycle}" class="${t.changed?'diff ':''}${t.cycle===Math.floor(cycle)?'current':''}" style="height:${12+33*Math.sqrt(t.onsets/max)}px" title="Cycle ${t.cycle}: ${t.onsets} onsets${t.changed?' · changed from previous':''}" aria-label="Visit cycle ${t.cycle}"></button>`).join('');
      get('#range-start').textContent=String(cycle).padStart(2,'0');get('#range-mid').textContent='Time is addressable. Repetition is never assumed.';get('#range-end').textContent=String(cycle+score.turns.length-1).padStart(2,'0');
      const sounds=[...new Set(score.turns.flatMap(t=>t.events.map(e=>e.sound)))];
      get('#sounds').replaceChildren(...sounds.map(s=>{const span=document.createElement('button');span.type='button';span.className='sound-key';span.setAttribute('aria-label',`Focus sound ${s}`);span.title='Click to focus this sound; click again to restore all voices';span.addEventListener('click',()=>{scene.setSolo(scene.solo===s?null:s);get('#sounds').querySelectorAll('button').forEach(b=>b.classList.toggle('solo',b===span&&scene.solo!==null));});const i=document.createElement('i');i.style.background=colourFor(s);span.append(i,document.createTextNode(s));return span;}));
      if(score.signalSamples){const band=document.createElement('span');band.className='signal-key';band.textContent=`∿ ${[...new Set(score.turns.flatMap(t=>t.signals.flatMap(s=>Object.keys(s.settings))))].join(' / ')} · continuous bands`;get('#sounds').append(band);}
      updateCurrent();resolve(true);
    };
    active.postMessage({source:source.value,start:Number(start.value),count:Number(count.value)});
  });
}
function selectProgram(id:string):Promise<boolean> {const p=programs.find(p=>p.id===id);if(!p)throw Error('Unknown program');program.value=id;source.value=p.source;count.value=String(p.cycles);start.value='0';get('#rows').textContent=p.rows;get('#program-hint').textContent=p.hint;return evaluate();}
for(const p of programs){const option=document.createElement('option');option.value=p.id;option.textContent=p.title;program.append(option);}
const custom=document.createElement('option');custom.value='custom';custom.textContent='Custom · pasted score';custom.disabled=true;program.append(custom);
source.addEventListener('input',()=>{program.value='custom';get('#rows').textContent='CUSTOM';get('#program-hint').textContent='Pasted score · queried directly by Strudel';});
program.addEventListener('change',()=>{selectProgram(program.value).catch(showError);});
get('#evaluate').addEventListener('click',()=>{evaluate().catch(showError);});
source.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();evaluate().catch(showError);}});
function showError(error:unknown){status.textContent=String(error);status.className='error';}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.addEventListener('click',()=>{const view=b.dataset.view;if(view==='ring'||view==='fly'||view==='side')setView(view);}));
get('#turns').addEventListener('click',e=>{if(e.target instanceof HTMLElement&&e.target.dataset.cycle)focus(Number(e.target.dataset.cycle));});
get('#reset').addEventListener('click',()=>scene.resetCamera());
get<HTMLSelectElement>('#detail').addEventListener('change',e=>{if(e.target instanceof HTMLSelectElement)scene.setDetail(e.target.value);});
play.addEventListener('click',()=>{silence();playing=!playing;play.textContent=playing?'Ⅱ Pause':'▶ Travel';});
get<HTMLSelectElement>('#ahead').addEventListener('change',e=>{if(e.target instanceof HTMLSelectElement)scene.setAhead(Number(e.target.value));});
tempo.addEventListener('change',()=>setAudioTempo(Math.max(1,Number(tempo.value))));
get<HTMLButtonElement>('#listen').addEventListener('click',()=>{
  if(listening){playing=false;play.textContent='▶ Travel';silence();return;}
  if(!score)return;
  const token=++audioGeneration;get<HTMLButtonElement>('#listen').disabled=true;get('#audio-state').textContent='Preparing audio…';
  startAudio(source.value,cycle,Math.max(1,Number(tempo.value)),()=>token===audioGeneration).then(()=>{
    if(token!==audioGeneration){stopAudio();return;}
    get<HTMLButtonElement>('#listen').disabled=false;listening=true;playing=true;get('#listen').textContent='Ⅱ Pause audio';play.textContent='Ⅱ Pause';
    get('#audio-state').textContent='Audio clock · bd / sd / hh use local percussion';
  }).catch(error=>{if(token!==audioGeneration)return;silence();get('#audio-state').textContent=`Audio failed · ${String(error)}`;});
});
const quantile=(a:number[],p:number)=>{const sorted=[...a].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0;};
function metrics():Metrics{return {frameMedianMs:quantile(frames,.5),frameP95Ms:quantile(frames,.95),drawMedianMs:quantile(draws,.5),drawP95Ms:quantile(draws,.95),frames:frames.length,onsets:score?.onsets??0,fragments:score?.fragments??0,signals:score?.signalSamples??0,drawn:scene.drawn,aggregated:scene.aggregated,queryMs:score?.queryMs??0,cycles:score?.turns.length??0};}
function frame(now:number) {
  const dt=now-last;last=now;
  if(playing&&score) {
    cycle=listening?Math.max(cycle,audioCycle()??cycle):cycle+dt/1000*Math.max(1,Number(tempo.value))/60;
    const first=score.turns[0]?.cycle??0,end=first+score.turns.length;if(cycle>=end){cycle=end-1e-6;silence();playing=false;play.disabled=true;play.textContent='Horizon reached';status.textContent=`Reached cycle ${end} · end of this query, not the pattern. Set FROM CYCLE to ${end} and Draw score to continue, or visit an earlier cycle.`;}
  }
  updateNowAddress();
  const begin=performance.now();scene.animate(cycle);const elapsed=performance.now()-begin;
  if(ready){frames.push(dt);draws.push(elapsed);if(frames.length>300)frames.shift();if(draws.length>300)draws.shift();}
  if(now-lastHud>40){lastHud=now;updateCurrent();get('#fps').textContent=String(Math.round(1000/(quantile(frames,.5)||16.7)));get('#detail-note').textContent=scene.aggregated?`${scene.aggregated.toLocaleString()} events merged · occupancy, 64 bins / cycle`:`${scene.drawn.toLocaleString()} visible event parts · ${scene.visibleTurns().length} turns`;}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Read-only measurement surface, apart from explicit UI actions in the test harness.
Object.assign(window,{spiral:{programs:programs.map(p=>({id:p.id,cycles:p.cycles,rows:p.rows})),get ready(){return ready;},get score(){return score;},metrics,camera:()=>scene.cameraState(),resetMetrics:()=>{frames=[];draws=[];},get cycle(){return cycle;},get view(){return scene.view;}}});
setView('ring');
selectProgram('alternation').catch(showError);
