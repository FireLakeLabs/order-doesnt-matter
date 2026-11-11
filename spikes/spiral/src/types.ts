export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export interface ScoreEvent {
  begin: number; end: number; partBegin: number; partEnd: number;
  onset: boolean; value: Value; sound: string; pitch: number | null;
  gain: number; cutoff: number; pan: number | null; heardEnd: number | null;
}
export interface SignalSample { begin:number; end:number; settings:Record<string,Value> }
export interface Turn {
  cycle:number; events:ScoreEvent[]; signals:SignalSample[];
  changed:boolean; fingerprint:string; onsets:number;
}
export interface Score {
  turns:Turn[]; cps:number; queryMs:number; onsets:number; fragments:number;
  signalSamples:number; controls:string[]; warnings:string[];
}
export type View = 'fly' | 'ring' | 'side';
export interface QueryRequest { source:string; start:number; count:number }
export type QueryReply = { ok:true; score:Score } | { ok:false; error:string };
export interface Metrics { frameMedianMs:number; frameP95Ms:number; drawMedianMs:number; drawP95Ms:number; frames:number; onsets:number; fragments:number; signals:number; drawn:number; aggregated:number; queryMs:number; cycles:number }
