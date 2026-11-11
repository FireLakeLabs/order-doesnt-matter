// Audio lives behind the Play audio gesture. No remote sample bank is needed.
import {startAt} from './audio-start';
import type { StrudelWeb, Repl } from './strudel-web';
let web:StrudelWeb|undefined,repl:Repl|undefined,loading:Promise<void>|undefined;
let offset=0;
export async function prepareAudio():Promise<void>{
  loading??=(async()=>{
    web=await import('@strudel/web');
    repl=await web.initStrudel({sync:false,miniAllStrings:false});
    await web.initAudio({maxPolyphony:512});
    // Deterministic local percussion, matching the demonstration rig's substitutes.
    for(const name of ['bd','sd','hh']){
      const sr=48000,n=Math.floor(sr*(name==='bd'?.3:name==='sd'?.18:.06)),buffer=new ArrayBuffer(44+n*2),v=new DataView(buffer);
      const str=(i:number,s:string)=>[...s].forEach((c,j)=>v.setUint8(i+j,c.charCodeAt(0)));
      str(0,'RIFF');v.setUint32(4,36+n*2,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*2,true);
      let seed=1234;
      for(let i=0;i<n;i++){const t=i/sr;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/4294967296*2-1,x=name==='bd'?Math.sin(2*Math.PI*(48*t+7*(1-Math.exp(-t*22))))*Math.exp(-t*17):noise*Math.exp(-t*(name==='hh'?100:30))*.55;v.setInt16(44+i*2,x*25000,true);}
      const url=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
      await web.samples({[name]:[url]});await web.loadBuffer(url,web.getAudioContext(),name);
    }
  })();
  try{await loading;}catch(error){loading=undefined;throw error;}
}
export async function startAudio(source:string,cycle:number,cpm:number,isCurrent:()=>boolean):Promise<void>{
  await prepareAudio();if(!isCurrent())return;if(!web||!repl)throw Error('Audio unavailable');
  await web.getAudioContext().resume();if(!isCurrent())return;
  repl.stop();web.resetGlobalEffects();
  const p=await repl.evaluate(source,false);if(!isCurrent())return;
  if(repl.state.error||!p)throw repl.state.error??Error('No playable pattern');
  web.getSuperdoughAudioController().output.destinationGain.gain.value=.5;
  offset=cycle;repl.setCps(cpm/60);await repl.setPattern(startAt(p,cycle),true);
}
export function stopAudio(){repl?.stop();web?.resetGlobalEffects();}
export function audioCycle():number|undefined{
  if(!web||!repl?.scheduler.started)return undefined;
  const s=repl.scheduler;const cycle=offset+s.num_cycles_at_cps_change+(web.getAudioContext().currentTime-s.seconds_at_cps_change-s.latency)*s.cps;return Number.isFinite(cycle)?cycle:undefined;
}
export function setAudioTempo(cpm:number){repl?.setCps(cpm/60);}
