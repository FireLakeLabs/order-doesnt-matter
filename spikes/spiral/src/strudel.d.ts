declare module '@strudel/core' {
  export const evalScope: (...modules:unknown[])=>Promise<unknown>;
  export const evaluate: (source:string, transpiler:unknown)=>Promise<{pattern:unknown}>;
  export const register: (name:string, fn:(...args:any[])=>unknown, patternify?:boolean)=>unknown;
  export const Pattern: { prototype: { p: (this:unknown, label:unknown)=>unknown } };
  export const silence: unknown;
  export const stack: (...patterns:unknown[])=>unknown;
  export const noteToMidi: (note:string)=>number;
  export class State { constructor(span:TimeSpan); }
  export class TimeSpan { constructor(begin:number,end:number); }
}
declare module '@strudel/mini';
declare module '@strudel/tonal';
declare module '@strudel/transpiler';
declare module '@strudel/web' {
  export const initStrudel:import('./strudel-web').StrudelWeb['initStrudel'];
  export const initAudio:import('./strudel-web').StrudelWeb['initAudio'];
  export const getAudioContext:import('./strudel-web').StrudelWeb['getAudioContext'];
  export const samples:import('./strudel-web').StrudelWeb['samples'];
  export const loadBuffer:import('./strudel-web').StrudelWeb['loadBuffer'];
  export const resetGlobalEffects:import('./strudel-web').StrudelWeb['resetGlobalEffects'];
  export const getSuperdoughAudioController:import('./strudel-web').StrudelWeb['getSuperdoughAudioController'];
}
