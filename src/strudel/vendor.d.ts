// Pinned packages ship no declarations; describe only the surface exercised here.
declare module '@strudel/core' {
  export class TimeSpan {
    constructor(begin: number, end: number);
    begin: unknown;
    end: unknown;
  }
  export class State {
    constructor(span: TimeSpan, controls?: Record<string, unknown>);
    span: TimeSpan;
    controls: Record<string, unknown>;
  }
  export interface Hap {
    whole: TimeSpan | null;
    part: TimeSpan;
    value: unknown;
    hasOnset(): boolean;
  }
  export class Pattern {
    constructor(query: (state: State) => Hap[]);
    query(state: State): Hap[];
    queryArc(begin: number, end: number): Hap[];
  }
  export function isPattern(value: unknown): value is Pattern;
  export function pure(value: unknown): Pattern;
  export const silence: Pattern;
  export class Cyclist {
    constructor(options: {
      getTime: () => number;
      setInterval?: () => number;
      clearInterval?: () => void;
      onTrigger?: (
        hap: Hap,
        deadline: number,
        duration: number,
        cps: number,
        target: number,
      ) => void;
    });
    lastEnd: number;
    num_cycles_at_cps_change: number;
    seconds_at_cps_change: number;
    cps: number;
    latency: number;
    started: boolean;
    getTime(): number;
    setPattern(pattern: Pattern, autostart?: boolean): Promise<void>;
    stop(): void;
  }
}
declare module '@strudel/transpiler' {
  export function transpiler(source: string): { output: string };
}
