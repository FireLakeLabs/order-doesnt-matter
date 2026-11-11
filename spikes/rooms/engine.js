import * as web from '@strudel/web';
export { web };
export let repl;
let callback = () => {};
let generation=0;
export function onNote(fn) { callback = fn; }
export async function boot() {
  repl = await web.initStrudel({ sync:false, miniAllStrings:false, beforeEval:()=>{
    const original=web.Pattern.prototype.p;
    web.Pattern.prototype.p=function(id){return original.call(this.set({_roomVoice:String(id)}),id);};
  }, editPattern:p => p.onTrigger((h,_t,_c,target) => {
    const wait=Math.max(0,(target-web.getAudioContext().currentTime)*1000);
    const rev=generation;setTimeout(()=>{if(rev===generation)callback(h.value,Number(h.whole?.begin));},wait);
  },false) });
  await registerLocal();
}
function wav(seconds) {
  const sr=24000,n=Math.round(sr*seconds),buffer=new ArrayBuffer(44+2*n),v=new DataView(buffer);
  const str=(p,s)=>[...s].forEach((c,i)=>v.setUint8(p+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,36+2*n,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,2*n,true);
  for(let i=0;i<n;i++){const t=i/sr; const f=220+220*Math.floor(t/seconds*4);const x=.5*Math.sin(2*Math.PI*f*t)*Math.min(1,t*300,(seconds-t)*300);v.setInt16(44+i*2,Math.round(x*32760),true);}
  return URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
}
export const sampleURLs={};
async function registerLocal(){
  for(const [name,seconds] of [['local',.8],['longlocal',1.6]]){sampleURLs[name]=wav(seconds);await web.samples({[name]:[sampleURLs[name]]});}
}
export function invalidate(){generation++;}
export async function evaluate(code,play=false){
  invalidate();
  const p=await repl.evaluate(code,play);
  if(repl.state.error||!p) throw repl.state.error||Error('No pattern returned');
  return p;
}
function seeded(seed=719){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export function snapshotHaps(p,cycles=1){return p.queryArc(0,cycles,{_cps:1}).filter(h=>h.hasOnset()).map(h=>({begin:Number(h.whole.begin),end:Number(h.whole.end),duration:Number(h.duration),value:h.value}));}
export async function render(code,{seconds=3,cycles=1,staged=false}={}){
  repl.stop();
  const p=await evaluate(code);
  const old=web.getAudioContext(),oldController=web.getSuperdoughAudioController();
  const context=new OfflineAudioContext(2,Math.round(seconds*24000),24000);
  web.setAudioContext(context);web.setSuperdoughAudioController(new oldController.constructor(context));
  const random=Math.random;Math.random=seeded();
  const events=snapshotHaps(p,cycles).sort((a,b)=>a.begin-b.begin);
  const controls=[];
  const nested=[];const nativeRender=OfflineAudioContext.prototype.startRendering;
  OfflineAudioContext.prototype.startRendering=function(...args){const p=nativeRender.apply(this,args);if(this!==context)nested.push(p);return p;};
  try{
    await web.initAudio({maxPolyphony:128});
    for(const e of events){await web.superdough(structuredClone(e.value),e.begin+.05,e.duration,1,e.begin); const c=web.getSuperdoughAudioController();controls.push({at:e.begin,orbits:Object.fromEntries(Object.entries(c.nodes).map(([n,o])=>[n,{delay:o.delayNode?.delayTime.value,feedback:o.delayNode?.feedback.value,roomsize:o.reverbNode?.duration}]))});}
    // Observe and await actual nested IR rendering, including all regenerations.
    // A non-null convolver.buffer alone does not mean later regenerations finished.
    await Promise.all(nested);await new Promise(r=>setTimeout(r,0));
    const finalOrbits=Object.fromEntries(Object.entries(web.getSuperdoughAudioController().nodes).map(([n,o])=>[n,{roomsize:o.reverbNode?.duration,impulseSeconds:o.reverbNode?.buffer?.duration}]));
    // Optional checkpoints allow superdough's onended-based duck/bmod adapters to run.
    const suspensions=[];
    if(staged)for(let t=.02;t<seconds;t+=.02)suspensions.push(context.suspend(t).then(()=>new Promise(r=>setTimeout(r,0))).then(()=>context.resume()));
    const audio=await context.startRendering();await Promise.all(suspensions);
    const endOrbits=Object.fromEntries(Object.entries(web.getSuperdoughAudioController().nodes).map(([n,o])=>[n,{delaytime:o.delayNode?.delayTime.value,feedback:o.delayNode?.feedback.value}]));
    return {channels:[audio.getChannelData(0).slice(),audio.getChannelData(1).slice()],sr:audio.sampleRate,events,controls,finalOrbits,endOrbits};
  }finally{OfflineAudioContext.prototype.startRendering=nativeRender;Math.random=random;web.setAudioContext(old);web.setSuperdoughAudioController(oldController);}
}
export function metrics(r,start=0,end=Infinity){
  const {channels,sr}=r,a=Math.floor(start*sr),b=Math.min(channels[0].length,Math.floor(end*sr));let sum=0,peak=0,last=0;
  const envelope=[];
  for(let i=a;i<b;i++){for(const ch of channels){sum+=ch[i]**2;peak=Math.max(peak,Math.abs(ch[i]));} }
  for(let i=a;i<b;i+=240){let s=0;for(let j=i;j<Math.min(i+240,b);j++)for(const ch of channels)s+=ch[j]**2;const rms=Math.sqrt(s/(Math.min(240,b-i)*2));envelope.push(+rms.toFixed(6));if(rms>1e-4)last=(i+240)/sr;}
  // Hann-windowed 2048-point DFT on a representative active frame; spectral centroid.
  const N=2048,offset=Math.min(Math.floor((start+.12)*sr),b-N);let weighted=0,magSum=0;
  if(offset>=0)for(let k=1;k<N/2;k++){let re=0,im=0;for(let n=0;n<N;n++){const x=(channels[0][offset+n]+channels[1][offset+n])*.5*(.5-.5*Math.cos(2*Math.PI*n/(N-1)));re+=x*Math.cos(2*Math.PI*k*n/N);im-=x*Math.sin(2*Math.PI*k*n/N);}const m=Math.hypot(re,im);magSum+=m;weighted+=m*k*sr/N;}
  return {rms:Math.sqrt(sum/((b-a)*2)),peak,lastAboveMinus80dB:last,centroidHz:magSum?weighted/magSum:0,envelope};
}
export function compare(a,b,start=0,end=Infinity){let s=0,sa=0,sb=0,cross=0,max=0;const first=Math.floor(start*a.sr),last=Math.min(a.channels[0].length,b.channels[0].length,Math.floor(end*a.sr));for(let c=0;c<2;c++)for(let i=first;i<last;i++){const x=a.channels[c][i],y=b.channels[c][i],d=x-y;s+=d*d;sa+=x*x;sb+=y*y;cross+=x*y;max=Math.max(max,Math.abs(d));}return {nullRms:Math.sqrt(s/((last-first)*2)),relativeNull:Math.sqrt(s/Math.max(sa,1e-30)),maxDifference:max,zeroLagCorrelation:cross/Math.sqrt(sa*sb||1)};}
export async function liveRender(code,{seconds=2,cycles=1}={}){
  repl.stop();const p=await evaluate(code),old=web.getAudioContext(),oc=web.getSuperdoughAudioController();
  const ac=new AudioContext({sampleRate:24000});web.setAudioContext(ac);web.setSuperdoughAudioController(new oc.constructor(ac));
  const random=Math.random;Math.random=seeded();
  try{
    await ac.resume();await web.initAudio({maxPolyphony:128});
    const src=`class Tap extends AudioWorkletProcessor{process(inputs){if(inputs[0]?.[0])this.port.postMessage({frame:currentFrame,channels:inputs[0].map(c=>c.slice())});return true;}}registerProcessor('pcm-tap',Tap)`;
    const url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));await ac.audioWorklet.addModule(url);URL.revokeObjectURL(url);
    const tap=new AudioWorkletNode(ac,'pcm-tap',{numberOfInputs:1,numberOfOutputs:1,channelCount:2});
    web.getSuperdoughAudioController().output.destinationGain.connect(tap);tap.connect(ac.destination);
    const origin=Math.ceil((ac.currentTime+.2)*ac.sampleRate/128)*128/ac.sampleRate;
    const channels=[new Float32Array(seconds*ac.sampleRate),new Float32Array(seconds*ac.sampleRate)],sr=ac.sampleRate;
    const observed=[];
    tap.port.onmessage=({data})=>{const offset=data.frame-Math.round(origin*sr);for(let c=0;c<2;c++)for(let i=0;i<data.channels[c]?.length;i++)if(offset+i>=0&&offset+i<channels[c].length)channels[c][offset+i]=data.channels[c][i];};
    const events=snapshotHaps(p,cycles).sort((a,b)=>a.begin-b.begin);
    for(const e of events){const target=origin+.05+e.begin; const ms=Math.max(0,(target-ac.currentTime-.06)*1000);await new Promise(r=>setTimeout(r,ms));await web.superdough(structuredClone(e.value),target,e.duration,1,e.begin);observed.push({onset:e.begin,scheduledAt:ac.currentTime-origin,roomsize:web.getSuperdoughAudioController().nodes[1]?.reverbNode?.duration});}
    while(ac.currentTime<origin+seconds+.1)await new Promise(r=>setTimeout(r,30));
    return {channels,sr,events,observed};
  }finally{Math.random=random;await ac.close();web.setAudioContext(old);web.setSuperdoughAudioController(oc);}
}
export async function liveAnalyze(){
  const ac=web.getAudioContext();await ac.resume();await web.initAudio({maxPolyphony:128});
  const t=ac.currentTime+.1;
  await web.superdough({s:'sine',freq:440,gain:.3,analyze:41},t,.4,1);
  await new Promise(r=>setTimeout(r,300));const data=web.getAnalyzerData('time',41);
  return {rms:Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length),bins:data.length};
}

export async function sampleMetadata(){
 const url=sampleURLs.local;
 const before=Boolean(web.getCachedBuffer(url));
 const p=await evaluate('s("local").fit()');const queried=snapshotHaps(p);
 const afterQuery=Boolean(web.getCachedBuffer(url));
 const buffer=await web.loadBuffer(url,web.getAudioContext(),'local');
 return {registered:true,before,afterQuery,decodedDuration:buffer.duration,afterDecode:Boolean(web.getCachedBuffer(url)),queried};
}

export function alignedComparison(a,b){
 const x=a.channels[0],y=b.channels[0],len=Math.min(x.length,y.length);let best={correlation:-1,lag:0};
 for(let lag=-256;lag<=256;lag+=4){let ab=0,aa=0,bb=0;for(let i=256;i<len-256;i+=4){ab+=x[i]*y[i+lag];aa+=x[i]**2;bb+=y[i+lag]**2;}const correlation=ab/Math.sqrt(aa*bb||1);if(correlation>best.correlation)best={correlation,lag};}
 let sum=0,count=0;for(let c=0;c<2;c++)for(let i=256;i<len-256;i++){sum+=(a.channels[c][i]-b.channels[c][i+best.lag])**2;count++;}
 return {...best,lagSeconds:best.lag/a.sr,nullRms:Math.sqrt(sum/count)};
}
