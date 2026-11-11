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
