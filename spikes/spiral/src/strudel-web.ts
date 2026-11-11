// Narrow adapter for the pinned web bundle, which ships no TypeScript declarations.
interface AudioTime {valueOf():number;mul(value:number):AudioTime}
interface AudioSpan {withTime(map:(time:AudioTime)=>AudioTime):AudioSpan}
export interface AudioPattern {
  early(cycles:number):AudioPattern;
  withHapSpan(map:(span:AudioSpan)=>AudioSpan):AudioPattern;
}
export interface Repl {
  scheduler:{started:boolean;num_cycles_at_cps_change:number;seconds_at_cps_change:number;latency:number;cps:number};
  state:{error:unknown};
  evaluate(source:string,autostart:boolean):Promise<AudioPattern|undefined>;
  setPattern(pattern:AudioPattern,autostart:boolean):Promise<unknown>;
  setCps(cps:number):void;stop():void;
}
export interface StrudelWeb {
  initStrudel(options:{sync:boolean;miniAllStrings:boolean}):Promise<Repl>;
  initAudio(options:{maxPolyphony:number}):Promise<unknown>;
  getAudioContext():AudioContext;
  samples(bank:Record<string,string[]>):Promise<unknown>;
  loadBuffer(url:string,context:AudioContext,name:string):Promise<unknown>;
  getSuperdoughAudioController():{output:{destinationGain:GainNode}};
  resetGlobalEffects():void;
}
