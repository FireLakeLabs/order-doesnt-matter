import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import type { EventResult, QueryEvents } from '../contract';
import { MAX_WINDOW_STARTS } from '../engine/playback-limits';
import {
  installStandIns,
  outputMethods,
  plainEvent,
  query,
  restoreStandIns,
  transpile,
} from './index';

mini.miniAllStrings();
// @strudel/draw's pinned animate module registers fill as ordinary score data.
// This adapter deliberately registers that parameter without importing canvas/audio.
const drawParameters = core.createParams('fill');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;
let tail: Promise<unknown> = Promise.resolve();

/** Serializing in-process questions protects Strudel's shared prototype stand-ins.
 * Use evaluate-node for untrusted/nonterminating code; this host is not a sandbox.
 */
export const queryEvents: QueryEvents = (code, from, to) => queryEventsWithBudget(code, from, to);
export function queryEventsWithBudget(
  code: string,
  from: number,
  to: number,
  eventBudget = 100_000,
  playbackStarts?: number[],
  initialCps = 0.5,
  inspect?: (pattern: core.Pattern, cps: number) => void,
): Promise<EventResult> {
  const next = tail.then(() =>
    evaluate(code, from, to, eventBudget, playbackStarts, initialCps, inspect),
  );
  tail = next.catch(() => {});
  return next;
}
async function evaluate(
  source: string,
  from: number,
  to: number,
  budget: number,
  playbackStarts?: number[],
  initialCps = 0.5,
  inspect?: (pattern: core.Pattern, cps: number) => void,
): Promise<EventResult> {
  const result: EventResult = { events: [], cps: initialCps, error: null, opaqueValues: false };
  let phase: 'evaluation' | 'query' = 'evaluation';
  const labels = new Map<string, core.Pattern>();
  const transforms: ((pattern: unknown) => unknown)[] = [];
  // register() changes both of these shared registries. Restore their descriptors
  // as well as the seam's stand-ins so one question cannot define the next host.
  const prototype = Object.getOwnPropertyDescriptors(core.Pattern.prototype);
  const registered = Object.getOwnPropertyDescriptors(core.strudelScope);
  const saved = installStandIns(labels);
  // Depends on pinned Pattern.__pure for pattern-valued tempo controls; canary
  // coverage exercises setCpm(pure(120)) without asking a signal for a value.
  const scalar = (value: unknown) =>
    Number(core.isPattern(value) ? (value as core.Pattern & { __pure: unknown }).__pure : value);
  const scope: Record<string, unknown> = {
    ...core,
    ...mini,
    ...tonal,
    ...drawParameters,
    console: { log() {}, warn() {}, error() {} },
    samples: async () => {},
    hush: () => core.silence,
    setcpm: (value: unknown) => {
      result.cps = scalar(value) / 60;
      return core.silence;
    },
    setcps: (value: unknown) => {
      result.cps = scalar(value);
      return core.silence;
    },
    all: (f: (pattern: unknown) => unknown) => {
      transforms.push(f);
      return core.silence;
    },
    slider: (value: unknown) => value,
    sliderWithID: (_id: unknown, value: unknown) => value,
    register: (...args: unknown[]) => {
      const value = core.register(...args);
      Object.assign(scope, core.strudelScope);
      return value;
    },
  };
  scope.setCpm = scope.setcpm;
  for (const name of outputMethods) scope[name] = () => core.silence;
  function normalize(value: unknown, seen = new Set<object>()): unknown {
    if (typeof value === 'function') {
      result.opaqueValues = true;
      return '[function:unchecked]';
    }
    if (value === undefined) return '[undefined]';
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'number' && !Number.isFinite(value)) return `[${value}]`;
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) {
      result.opaqueValues = true;
      return '[circular:unchecked]';
    }
    seen.add(value);
    const plain = Array.isArray(value)
      ? value.map((v) => normalize(v, seen))
      : Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, normalize(v, seen)]),
        );
    seen.delete(value);
    return plain;
  }
  try {
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      to < from ||
      !Number.isInteger(budget) ||
      budget < 0
    )
      throw Error('Expected a finite ordered cycle range and a nonnegative integer event budget');
    const code = transpile(source);
    const output = await new AsyncFunction('host', `with(host){ return (async()=>{${code}\n})() }`)(
      scope,
    );
    let pattern = labels.size ? core.stack(...labels.values()) : output;
    for (const f of transforms) pattern = f(pattern);
    if (!core.isPattern(pattern)) throw Error('Program did not produce a Pattern');
    phase = 'query';
    if (inspect) {
      inspect(pattern, result.cps);
      return result;
    }
    const ranges: [number, number][] = [];
    const addCycles = (begin: number, end: number) => {
      for (let cycle = Math.floor(begin); cycle < end; cycle++)
        ranges.push([Math.max(cycle, begin), Math.min(cycle + 1, end)]);
    };
    if (playbackStarts) {
      if (
        !Number.isFinite(result.cps) ||
        result.cps <= 0 ||
        playbackStarts.some((n) => !Number.isFinite(n))
      )
        throw Error('Playback needs a positive tempo and finite section starts');
      // Cyclist 1.2.6 cyclist.mjs:35–60 + zyklus.mjs:7–10,22–31:
      // 50 ms windows, up to four in the initial 200 ms lookahead.
      for (const begin of [from, ...playbackStarts])
        for (let i = 0; i < 4; i++)
          ranges.push([begin + i * 0.05 * result.cps, begin + (i + 1) * 0.05 * result.cps]);
    }
    addCycles(from, to);
    for (const begin of playbackStarts ?? []) addCycles(begin, begin + 2);
    for (const [begin, end] of ranges) {
      const haps = query(pattern, begin, end, {
        _cps: result.cps,
        ...(playbackStarts ? { cyclist: 'cyclist' } : {}),
      });
      // Preflight still executes the full question, but does not copy a flood
      // back onto the page. Playback applies its own per-window voice limit.
      const selected = playbackStarts
        ? haps.filter((h) => h.hasOnset()).slice(0, MAX_WINDOW_STARTS)
        : haps;
      if (result.events.length + selected.length > budget)
        throw Error(`${budget} event budget exceeded`);
      for (const hap of selected) {
        const event = plainEvent(hap);
        result.events.push({ ...event, value: normalize(event.value) });
      }
    }
  } catch (error) {
    result.error = { phase, message: error instanceof Error ? error.message : String(error) };
  } finally {
    restoreStandIns(saved);
    for (const key of Object.getOwnPropertyNames(core.Pattern.prototype))
      if (!(key in prototype)) Reflect.deleteProperty(core.Pattern.prototype, key);
    Object.defineProperties(core.Pattern.prototype, prototype);
    for (const key of Object.keys(core.strudelScope))
      if (!(key in registered)) Reflect.deleteProperty(core.strudelScope, key);
    Object.defineProperties(core.strudelScope, registered);
  }
  return result;
}
