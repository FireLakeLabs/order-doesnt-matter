import {web,evaluate,repl,onNote,invalidate} from './engine.js';
import {programs} from './programs.js';
const stages=[['workletSrc','Kabel'],['stretch','Stretch'],['transient','Transient'],['gain','Gain'],['cutoff','LPF'],['hcutoff','HPF'],['bandf','BPF'],['vowel','Vowel'],['coarse','Coarse'],['crush','Crush'],['shape','Shape'],['distort','Distort'],['tremolo','Tremolo'],['compressor','Comp'],['pan','Pan'],['phaserrate','Phaser']];
const colors=['#a7edce','#c4a1ed','#efbd79','#81b8dc'];
const app=document.querySelector('#app');
app.innerHTML=`<header><a class="brand">odm<span>ORDER DOESN’T MATTER</span></a><div class="transport"><i id="lamp"></i><span id="state">READY · STRUDEL 1.3.0</span><button id="play">▶ Play</button><button id="stop">Stop</button></div></header><main><div class="heading"><div><div class="eyebrow">PHASE 0 / SOUND & SHARED STATE</div><h1>Voices have paths. Echoes share rooms.</h1><p id="subtitle"></p></div><select aria-label="Example program">${programs.map((p,i)=>`<option value="${i}">${p.title}</option>`).join('')}</select></div><div class="topline"><span>01 / THE LAST NOTE <b id="latest">WAITING FOR PLAY</b></span><span>DIM = NOT CARRIED BY THIS NOTE · GLOW = ONSET</span></div><section class="strip"><div id="source"></div><div id="inserts"></div><div id="native"></div><div class="post">POSTGAIN → SENDS + DRY → ORBIT SUM → DJ FILTER → DUCK → OUTPUT</div></section><div class="workspace"><section class="score"><div class="eyebrow">02 / THE SENDERS</div><div id="ring"></div><div id="voices"></div><p class="small">One turn = one cycle · heads are scored onsets<br>Labels identify patterns; unlabelled branches group by sound + orbit.</p></section><section class="rooms"><div class="eyebrow">03 / SHARED ROOMS <span id="scope">CURRENT CYCLE</span></div><div id="rooms"></div><div id="relations"></div></section></div><section class="editor"><div class="editorhead"><span>THE PROGRAM / EDIT & PLAY</span><span id="query">Real Strudel events. Live engine settings.</span></div><textarea aria-label="Strudel program" spellcheck="false"></textarea><div id="error" role="status"></div></section><footer><span>MINT / VIOLET / AMBER · VOICE FAMILIES</span><span>Rings show score. Room values show engine state at scheduling time.</span></footer></main>`;
const $=s=>document.querySelector(s),esc=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=x=>typeof x==='number'?(Math.abs(x)>100?Math.round(x):+x.toFixed(3)):typeof x==='object'?JSON.stringify(x):String(x);
let pattern,events=[],playing=false,last={},lastAt=0,noteCount=0,lastQueryCycle=-1,revision=0;
const voiceName=v=>v._roomVoice??`${v.s??'value'} · orbit ${v.orbit??1}`;
const voiceNames=()=>[...new Set(events.map(e=>voiceName(e.value)))];
const color=name=>colors[({MINT:0,VIOLET:1,AMBER:2})[name]??Math.max(0,voiceNames().indexOf(name))%colors.length];
function note(v){last=v;lastAt=performance.now();noteCount++;drawStrip();$('#latest').textContent=`${voiceName(v)} / ${v.note??v.s??'EVENT'} · #${noteCount}`;drawRooms();}
onNote(v=>{if(playing)note(v);});
function stageHTML(v){return stages.map(([key,title],i)=>`<div class="stage ${key in v?'used':''}" title="${esc(key)}: ${esc(short(v[key]))}"><div class="stagecircle">${key in v?esc(short(v[key])):'·'}</div><span>${String(i+1).padStart(2,'0')} ${title}</span></div>`).join('');}
function drawStrip(){
 const v=last;$('#native').innerHTML=stageHTML(v);$('.strip').style.setProperty('--voice',color(voiceName(v)));
 $('.strip').classList.toggle('pulse',playing&&performance.now()-lastAt<190);
 $('#source').innerHTML=`<span class="eyebrow">SOURCE + ENVELOPE</span><b>${esc(v.s??'—')} <em>${esc(v.note??v.freq??'')}</em></b><span>${['attack','decay','sustain','release','clip'].filter(k=>k in v).map(k=>`${k} ${esc(short(v[k]))}`).join(' · ')||(v.s?'Envelope uses engine defaults':'No note selected')}</span>`;
 const fx=v.FX??[];
 $('#inserts').innerHTML=`<span class="eyebrow">ORDERED INSERTS</span><div class="fxchain">${fx.length?fx.map((f,i)=>`<div class="fx"><b>${i+1}</b> ${Object.entries(f).map(([k,x])=>`${esc(k)} ${esc(short(x))}`).join(' · ')}<small>${f.gain===undefined?"implicit gain .8":"explicit gain"}</small></div>`).join('<span class="arrow">→</span>'):'<span class="empty">No .FX() inserts</span>'}<span class="arrow">→</span><span class="nativeLabel">NATIVE PATH ↓</span></div>`;
}
function refreshQuery(){
 if(!pattern)return;
 const s=repl.scheduler;
 const now=playing&&s.started?s.num_cycles_at_cps_change+(web.getAudioContext().currentTime-s.seconds_at_cps_change-s.latency)*s.cps:0;
 const cycle=Math.max(0,Math.floor(now));
 if(cycle!==lastQueryCycle){events=pattern.queryArc(cycle,cycle+1,{_cps:s.cps}).filter(h=>h.whole&&h.hasOnset()).map(h=>({begin:Number(h.whole.begin)-cycle,end:Number(h.whole.end)-cycle,value:h.value}));lastQueryCycle=cycle;drawRooms();$('#query').textContent=`Cycle ${cycle} · ${events.length} onsets · ${s.cps.toFixed(2)} cycles / sec`;}
 drawRing(((now%1)+1)%1);
}
function drawRing(phase){
 const names=voiceNames(),cx=148,cy=137;
 const pt=(a,r)=>[cx+Math.sin(a*2*Math.PI)*r,cy-Math.cos(a*2*Math.PI)*r];
 let svg=`<svg viewBox="0 0 296 278" aria-label="Scored cycle"><circle cx="${cx}" cy="${cy}" r="105" fill="none" stroke="#2c4940"/><circle cx="${cx}" cy="${cy}" r="75" fill="none" stroke="#20382f"/><text x="148" y="133" text-anchor="middle" fill="#e0f3e6" font-size="24">${String(Math.floor(phase*100)).padStart(2,'0')}</text><text x="148" y="152" text-anchor="middle" fill="#8aa99a" font-size="8" letter-spacing="2">CYCLE PHASE</text>`;
 for(let i=0;i<16;i++){const p=pt(i/16,110),q=pt(i/16,115);svg+=`<path d="M${p}L${q}" stroke="#476556"/>`;}
 for(const e of events.slice(0,256)){const name=voiceName(e.value),r=105-names.indexOf(name)*13,p=pt(e.begin,r);svg+=`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${color(name)}"/>`;}
 const p=pt(phase,119);svg+=`<path d="M148,137L${p}" stroke="#e1f2df" opacity=".4"/><circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#e1f2df"/></svg>`;$('#ring').innerHTML=svg;
 $('#voices').innerHTML=names.map(n=>{const es=events.filter(e=>voiceName(e.value)===n),v=es[0].value;return `<div class="sender" style="--c:${color(n)}"><i></i><b>${esc(n)}</b><span>${esc(v.s)} → room ${v.orbit??1}</span><small>${es.length} notes</small></div>`;}).join('');
}
function drawRooms(){
 const groups=new Map();for(const e of events){const v=e.value,n=v.orbit??1;if(!groups.has(n))groups.set(n,[]);groups.get(n).push(v);}
 const controller=web.getSuperdoughAudioController();for(const n of Object.keys(controller.nodes))if(!groups.has(Number(n))&&!groups.has(n))groups.set(Number(n),[]);
 $('#rooms').innerHTML=[...groups].map(([n,vs])=>{
 const senders=[...new Set(vs.map(voiceName))];
 const controls=['delaytime','delayfeedback','roomsize','roomfade','roomlp','roomdim'];
 const conflicts=controls.filter(k=>new Set(vs.filter(v=>k in v).map(v=>JSON.stringify(v[k]))).size>1);
 const actual=controller.nodes[n];
 const settings={delaytime:actual?.delayNode?.delayTime.value,feedback:actual?.delayNode?.feedback.value,roomsize:actual?.reverbNode?.duration,IRseconds:actual?.reverbNode?.buffer?.duration};
 const current=Object.entries(settings).filter(([,v])=>v!==undefined).map(([k,v])=>`${k} ${short(v)}`).join(' · ');
 return `<article class="room ${conflicts.length?'conflict':''}"><div class="orbit"><div class="orbitInner"><small>ORBIT</small><b>${esc(n)}</b></div>${senders.map((name,i)=>`<i style="--dot:${color(name)};transform:rotate(${i*120-35}deg) translateY(-48px)"></i>`).join('')}</div><div class="roomdata"><div class="roomtitle">Room ${esc(n)} ${conflicts.length?'<strong>⚡ CONFLICT</strong>':'<span>INDEPENDENT</span>'}</div><p class="current">${current?`ENGINE NOW · ${esc(current)}`:actual?'ENGINE NOW · dry path only':'Engine idle · values below are score intentions'}</p>${senders.map(name=>{const vals=vs.filter(v=>voiceName(v)===name);return `<div class="send" style="--c:${color(name)}"><b>${esc(name)} <span>→</span></b><span>${[...new Set(vals.map(v=>`delay ${v.delay??0} / room ${v.room??0}`))].map(esc).join(' · ')}</span><small>${controls.filter(k=>vals.some(v=>k in v)).map(k=>`${k} ${[...new Set(vals.filter(v=>k in v).map(v=>short(v[k])))].join(' / ')}`).map(esc).join(' · ')||'dry only'}</small></div>`;}).join('')}${conflicts.length?`<p class="warning">${conflicts.join(' + ')} differ in this cycle.<br>Delay changes at onset; reverb changes when scheduled.<br>Lookahead can replace reverb before the displayed note sounds.<br>IR generation is async; an older buffer can finish last.</p>`:''}</div></article>`;
 }).join('')||'<p class="small">No orbit-bearing events in this cycle.</p>';
 const rel=[];const cuts=new Map();for(const v of events.map(e=>e.value)){
  if(v.duckorbit!==undefined)for(const n of [v.duckorbit].flat())rel.push(`<b>${esc(voiceName(v))}</b> <span class="duck">→ ducks</span> ${[...new Set(events.filter(e=>(e.value.orbit??1)===n).map(e=>voiceName(e.value)))].map(esc).join(" + ")||"ROOM"} (room ${esc(n)}) <small>depth ${v.duckdepth??1} · recover ${v.duckattack??.1}s</small>`);
  if(v.cut!==undefined){if(!cuts.has(v.cut))cuts.set(v.cut,new Set());cuts.get(v.cut).add(voiceName(v));}
  if(v.bus!==undefined)rel.push(`<b>${esc(voiceName(v))}</b> → BUS ${esc(v.bus)} <small>send ${v.busgain??1}; consumer needs .bmod()</small>`);
  if(v.analyze)rel.push(`<b>${esc(voiceName(v))}</b> → ANALYZER ${esc(v.analyze)} <small>meter tap; sound unchanged</small>`);
  if(v.bmod)rel.push(`<b>${esc(voiceName(v))}</b> ← BUS MOD <small>${esc(JSON.stringify(v.bmod))}</small>`);
 }
 for(const [n,names]of cuts)rel.push(`<b>${[...names].map(esc).join(' ↔ ')}</b> <span class="cut">CUT ${esc(n)}</span><small>next sample fades the previous in 10ms; synths unaffected</small>`);
 $('#relations').innerHTML=`<div class="eyebrow">RELATIONSHIPS / CROSS-NOTE STATE</div>${[...new Set(rel)].map(r=>`<div class="relation">${r}</div>`).join('')||'<p class="small">No duck, cut or bus relationships in this cycle.</p>'}`;
}
async function apply(play){
 const rev=++revision;$('#error').textContent='';
 try{repl.stop();web.resetGlobalEffects();if(play){await web.getAudioContext().resume();await web.initAudio({maxPolyphony:128});}pattern=await evaluate($('textarea').value,play);if(rev!==revision)return;playing=play;lastQueryCycle=-1;refreshQuery();if(!play){last=events[0]?.value??{};drawStrip();}$('#state').textContent=play?'PLAYING · LIVE WEB AUDIO':'READY · SCORE PREVIEW';$('#lamp').classList.toggle('on',play);}
 catch(e){playing=false;$('#error').textContent=e.message;$('#state').textContent='PROGRAM ERROR';}
}
$('#play').onclick=()=>apply(true);
$('#stop').onclick=()=>{revision++;invalidate();playing=false;repl.stop();web.resetGlobalEffects();$('#state').textContent='STOPPED';$('#lamp').classList.remove('on');drawStrip();drawRooms();};
async function select(){const p=programs[+$('select').value];$('textarea').value=p.code;$('#subtitle').textContent=p.subtitle;await apply(false);}
$('select').onchange=select;
await select();
setInterval(()=>{refreshQuery();$('.strip').classList.toggle('pulse',playing&&performance.now()-lastAt<190);if(playing)drawRooms();},60);
window.roomUI={get events(){return events},get noteCount(){return noteCount},get playing(){return playing}};
