import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { transpiler } from '@strudel/transpiler';
import type { QueryRequest, QueryReply, Score, ScoreEvent, SignalSample, Value, Turn } from './types';

interface Span { begin:unknown; end:unknown }
interface Hap { whole?:Span; part:Span; value:unknown }
interface Pattern { queryArc:(begin:number,end:number)=>Hap[]; query:(state:core.State)=>Hap[] }
function isPattern(value:unknown):value is Pattern {
  return typeof value==='object' && value!==null && 'queryArc' in value && typeof value.queryArc==='function' && 'query' in value && typeof value.query==='function';
}
function bag(value:unknown):Record<string,unknown> {
  return typeof value==='object' && value!==null && !Array.isArray(value) ? value as Record<string,unknown> : {value};
}
function serial(value:unknown, depth=0):Value {
  if(depth>6) return '[nested]';
  if(typeof value==='function') return '[function — opaque]';
  if(value===null || typeof value==='string' || typeof value==='boolean') return value;
  if(typeof value==='number') return Number.isFinite(value)?value:String(value);
  if(Array.isArray(value)) return value.map(v=>serial(v,depth+1));
  if(typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,serial(v,depth+1)]));
  return String(value);
}
function num(value:unknown,fallback:number):number { const n=Number(value); return Number.isFinite(n)?n:fallback; }
function sound(value:Record<string,unknown>):string { return String(value.s ?? value.sound ?? (value.note!==undefined?'note':'value')); }
function pitch(value:Record<string,unknown>):number|null {
  if(value.note===undefined) return null;
  const p=typeof value.note==='number'?value.note:core.noteToMidi(String(value.note));
  return Number.isFinite(p)?p:null;
}
// Match @strudel/web 1.3.0 initStrudel's default mini-notation setup.
mini.miniAllStrings();
let cps=.5;
const labelled=new Map<string,Pattern>();
let anonymous=0;
const transforms:((p:unknown)=>unknown)[]=[];
function tempo(value:unknown, scale:number) { const n=num(value,0)*scale; if(n<=0)throw Error('Tempo must be positive'); cps=n; }
await core.evalScope(core,mini,tonal,{
  setcpm:(v:unknown)=>tempo(v,1/60), setcps:(v:unknown)=>tempo(v,1),
  all:(fn:(p:unknown)=>unknown)=>{transforms.push(fn);},
  samples:()=>{throw Error('samples() needs audio/sample loading, which is outside this visual spike. Remove that statement to inspect the score.');},
  hush:()=>{labelled.clear();anonymous=0;},
});
// Labels are names, not patterns: a registered pattern method would parse "$"
// as mini notation. Match the REPL's raw .p adapter instead.
core.Pattern.prototype.p=function(label:unknown) {
  if(typeof label!=='string')throw Error('Pattern labels must be strings.');
  if(label.startsWith('_')||label.endsWith('_'))return core.silence;
  if(!isPattern(this))throw Error('A label must belong to a pattern.');
  labelled.set(label.includes('$')?`${label}${anonymous++}`:label,this);
  return this;
};
function fingerprint(events:ScoreEvent[],samples:SignalSample[],cycle:number):string {
  return JSON.stringify([
    events.map(e=>[+(e.begin-cycle).toFixed(6),+(e.end-cycle).toFixed(6),e.onset,e.value]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
    samples.map(s=>s.settings),
  ]);
}
self.onmessage=async(event:MessageEvent<QueryRequest>)=>{
  try {
    const {source,start,count}=event.data;
    if(!Number.isInteger(start)||!Number.isInteger(count)||start<0||count<1||count>256)throw Error('Choose a non-negative start and 1–256 cycles.');
    cps=.5;labelled.clear();anonymous=0;transforms.length=0;
    const begin=performance.now();
    const evaluated=await core.evaluate(source,transpiler);
    const p=transforms.reduce((p,fn)=>fn(p),labelled.size?core.stack(...labelled.values()):evaluated.pattern);
    if(!isPattern(p))throw Error('The program did not return a pattern. End with a score expression or use $: labels.');
    // queryArc swallows query exceptions; raw query keeps failure distinct from silence.
    const query=(begin:number,end:number)=>p.query(new core.State(new core.TimeSpan(begin,end)));
    const turns:Turn[]=[]; const controls=new Set<string>(); let fragments=0,onsets=0,signalSamples=0;
    let previous='';
    // Include the previous cycle only for comparison, not in the requested score.
    for(let cycle=Math.max(0,start-1);cycle<start+count;cycle++) {
      const haps=query(cycle,cycle+1);
      const events:ScoreEvent[]=[];const signals:SignalSample[]=[];
      for(const h of haps) {
        const v=bag(h.value);Object.keys(v).forEach(k=>controls.add(k));
        if(!h.whole)continue;
        const b=num(h.whole.begin,NaN),e=num(h.whole.end,NaN),pb=num(h.part.begin,NaN),pe=num(h.part.end,NaN);
        if(![b,e,pb,pe].every(Number.isFinite))throw Error('A hap has an invalid time span.');
        const onset=Math.abs(b-pb)<1e-8;
        const duration=num(v.duration,e-b)*num(v.clip,1);
        const hasEstimate=v.clip!==undefined||v.release!==undefined||v.duration!==undefined;
        events.push({begin:b,end:e,partBegin:pb,partEnd:pe,onset,value:serial(h.value),sound:sound(v),pitch:pitch(v),gain:num(v.gain,1),cutoff:num(v.cutoff??v.lpf,5000),pan:v.pan===undefined?null:num(v.pan,.5),heardEnd:hasEstimate?b+duration+num(v.release,0)*cps:null});
      }
      if(haps.some(h=>!h.whole)) {
        for(let i=0;i<64;i++) {
          const b=cycle+i/64,e=cycle+(i+1)/64;
          for(const h of query(b,e))if(!h.whole) {
            const v=bag(h.value);
            signals.push({begin:b,end:e,settings:Object.fromEntries(Object.entries(v).map(([k,v])=>[k,serial(v)]))});
          }
        }
      }
      const key=fingerprint(events,signals,cycle);
      if(cycle>=start) {
        const n=events.filter(e=>e.onset).length;
        turns.push({cycle,events,signals,changed:cycle>0&&key!==previous,fingerprint:key,onsets:n});
        onsets+=n;fragments+=events.length-n;signalSamples+=signals.length;
        if(onsets+fragments+signalSamples>150000)throw Error('Window exceeds 150,000 haps/samples. Query fewer cycles or reduce density.');
      }
      previous=key;
    }
    const warnings:string[]=[];
    if(controls.size>8)warnings.push('Additional controls are preserved in the inspector; glyphs encode pitch, sound, gain, cutoff and score duration; signal bands encode sampled settings.');
    if(controls.has('clip')||controls.has('release'))warnings.push('Whiskers estimate clip + release. Sample tails, effects and audible duration are not measured.');
    if(turns.every(t=>!t.events.length&&!t.signals.length))warnings.push('This queried window contains no events.');
    const score:Score={turns,cps,queryMs:performance.now()-begin,onsets,fragments,signalSamples,controls:[...controls],warnings};
    self.postMessage({ok:true,score} satisfies QueryReply);
  } catch(error) {self.postMessage({ok:false,error:error instanceof Error?error.message:String(error)} satisfies QueryReply);}
};
