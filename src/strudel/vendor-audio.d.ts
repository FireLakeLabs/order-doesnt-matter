declare module '@strudel/web' {
  export { webaudioOutput } from '@strudel/webaudio';
  export {
    getAudioContext,
    initAudio,
    getSound,
    getSampleInfo,
    loadBuffer,
    samples,
    getSuperdoughAudioController,
  } from 'superdough';
  export interface AudioRepl {
    evaluate(code: string, autoplay: boolean): Promise<import('./index').Pattern | undefined>;
    setPattern(
      pattern: import('./index').Pattern,
      autoplay: boolean,
    ): Promise<import('./index').Pattern>;
    setCps(cps: number): void;
    scheduler: import('./index').Scheduler;
    stop(): void;
    state: { error?: Error };
  }
  export function initStrudel(options: {
    sync: boolean;
    miniAllStrings: boolean;
    editPattern(pattern: import('./index').Pattern): import('./index').Pattern;
    defaultOutput(
      hap: import('./index').Hap,
      deadline: number,
      duration: number,
      cps: number,
      time: number,
    ): Promise<void>;
  }): Promise<AudioRepl>;
}
declare module '@strudel/webaudio' {
  export function webaudioOutput(
    hap: import('./index').Hap,
    deadline: number,
    duration: number,
    cps: number,
    time: number,
  ): Promise<void>;
}
declare module 'superdough' {
  export function getAudioContext(): AudioContext;
  export function initAudio(): Promise<void>;
  export function getSound(
    name: string,
  ): { data: { type?: string; samples?: unknown } } | undefined;
  export function getSampleInfo(value: unknown, samples: unknown): { url: string };
  export function loadBuffer(
    url: string,
    context: AudioContext,
    name: string,
  ): Promise<AudioBuffer>;
  export function samples(map: object, base?: string): Promise<void>;
  export function getSuperdoughAudioController(): { output: { destinationGain: GainNode } };
}
