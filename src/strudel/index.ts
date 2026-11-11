import { Pattern, State, TimeSpan, silence } from '@strudel/core';
import type { Hap } from '@strudel/core';
import { transpiler } from '@strudel/transpiler';
export { isPattern } from '@strudel/core';
export type { Pattern, State, TimeSpan, Hap } from '@strudel/core';

// Depends on Pattern.query accepting internal State/TimeSpan, bypassing queryArc's catch.
export const query = (
  pattern: Pattern,
  begin: number,
  end: number,
  controls: Record<string, unknown> = {},
) => pattern.query(new State(new TimeSpan(begin, end), controls));
export interface PlainEvent {
  whole: [number, number] | null;
  part: [number, number];
  value: unknown;
  hasOnset: boolean;
}
export function plainEvent(hap: Hap): PlainEvent {
  const span = (s: TimeSpan): [number, number] => [Number(s.begin), Number(s.end)];
  return {
    whole: hap.whole ? span(hap.whole) : null,
    part: span(hap.part),
    value: hap.value,
    hasOnset: hap.hasOnset(),
  };
}
export const outputMethods = [
  'scope',
  'pianoroll',
  'punchcard',
  'spiral',
  'spectrum',
  'osc',
  'midi',
  'midin',
  'out',
  'output',
  'draw',
  'analyze',
] as const;
type Installation = Map<string, PropertyDescriptor | undefined>;
// Depends on REPL .p label conventions and writable Pattern.prototype output methods.
export function installStandIns(labels: Map<string, Pattern>): Installation {
  const saved: Installation = new Map();
  let anonymous = 0;
  const methods = {
    p(this: Pattern, name: string) {
      if (name.startsWith('_') || name.endsWith('_')) return silence;
      labels.set(name.includes('$') ? `${name}${anonymous++}` : name, this);
      return this;
    },
    ...Object.fromEntries(
      outputMethods.map((name) => [
        name,
        function (this: Pattern) {
          return this;
        },
      ]),
    ),
  };
  for (const [name, value] of Object.entries(methods)) {
    saved.set(name, Object.getOwnPropertyDescriptor(Pattern.prototype, name));
    Object.defineProperty(Pattern.prototype, name, { value, writable: true, configurable: true });
  }
  return saved;
}
// Depends on property descriptors being sufficient to undo the prototype stand-ins.
export function restoreStandIns(saved: Installation): void {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(Pattern.prototype, name, descriptor);
    else Reflect.deleteProperty(Pattern.prototype, name);
  }
}
// Depends on the transpiler's AST rewrite and generated m(...).p(...) source shape.
export const transpile = (source: string): string => transpiler(source).output;
// Depends on the transpiler recognizing this otherwise ordinary source comment.
export const MINI_OFF = '// mini-off';
export interface Scheduler {
  lastEnd: number;
  num_cycles_at_cps_change: number;
  seconds_at_cps_change: number;
  cps: number;
  latency: number;
  started: boolean;
  getTime(): number;
}
function schedulerState(value: unknown): Scheduler {
  if (!value || typeof value !== 'object') throw Error('Strudel scheduler: expected an object');
  const s = value as Record<string, unknown>;
  for (const key of [
    'lastEnd',
    'num_cycles_at_cps_change',
    'seconds_at_cps_change',
    'cps',
    'latency',
  ])
    if (typeof s[key] !== 'number' || !Number.isFinite(s[key]))
      throw Error(`Strudel scheduler private field changed: ${key}`);
  if (typeof s.started !== 'boolean')
    throw Error('Strudel scheduler private field changed: started');
  if (typeof s.getTime !== 'function')
    throw Error('Strudel scheduler private field changed: getTime');
  return value as Scheduler;
}
// Depends on Cyclist's private phase anchors and latency in its trigger-time equation.
export function playheadCycle(value: unknown): number {
  const s = schedulerState(value),
    now = s.getTime();
  if (!Number.isFinite(now)) throw Error('Strudel scheduler getTime() must return a finite number');
  return s.started
    ? s.num_cycles_at_cps_change + (now - s.seconds_at_cps_change - s.latency) * s.cps
    : 0;
}
// Depends on stopped Cyclist using lastEnd as its origin on restart.
export function seekTo(value: unknown, cycle: number, audioTime: number): void {
  const s = schedulerState(value);
  if (s.started) throw Error('Seek requires a stopped Strudel scheduler');
  if (!Number.isFinite(cycle) || !Number.isFinite(audioTime))
    throw Error('Seek requires finite cycle and audioTime');
  s.lastEnd = s.num_cycles_at_cps_change = cycle;
  s.seconds_at_cps_change = audioTime;
}
