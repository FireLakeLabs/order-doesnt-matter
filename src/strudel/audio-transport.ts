import { Pattern, State, TimeSpan } from '@strudel/core';
import type { Hap } from './index';
import type { CycleLoop, PlaybackSpeed } from '../contract';

/** Scheduler time stays monotonic. Queries and reported onsets address the score.
 * Depends on Hap.withSpan preserving value/context and fractional onset equality.
 * The canary crosses a loop boundary with the real Cyclist and tagged haps. */
export function loopPattern(
  pattern: Pattern,
  readLoop: () => CycleLoop | null,
  sourceCycles: WeakMap<Hap, number>,
) {
  return new Pattern((state) => {
    const loop = readLoop();
    if (!loop) return pattern.query(state);
    const haps: Hap[] = [];
    const end = Number(state.span.end);
    let begin = Number(state.span.begin);
    while (begin < end) {
      const length = loop.to - loop.from;
      const offset = Math.floor((begin - loop.from) / length) * length;
      const source = begin - offset;
      const to = Math.min(end, loop.to + offset);
      for (const hap of pattern.query(
        new State(new TimeSpan(source, to - offset), state.controls),
      )) {
        const shifted = hap.withSpan(
          (span) => new TimeSpan(Number(span.begin) + offset, Number(span.end) + offset),
        );
        sourceCycles.set(shifted, Number(hap.whole?.begin ?? hap.part.begin));
        haps.push(shifted);
      }
      begin = to;
    }
    return haps;
  });
}

/** Studio-only hush. Keep the output gain (and its measuring tap) connected.
 * Depends on Superdough 1.3.0 orbit/bus dictionaries: reset disconnects these
 * same nodes. Browser canary measures silence, including scheduled future notes. */
export function discardVoices(controller: {
  nodes: Record<string, { disconnect(): void }>;
  buses: Record<string, { disconnect(): void }>;
}) {
  for (const node of [...Object.values(controller.nodes), ...Object.values(controller.buses)])
    node.disconnect();
  controller.nodes = {};
  controller.buses = {};
}

/** Event-authored tempo uses the same transport factor as setcpm. */
export function speedPattern(pattern: Pattern, readSpeed: () => PlaybackSpeed) {
  return new Pattern((state) =>
    pattern.query(state).map((hap) => {
      const factor = readSpeed();
      if (factor === 1 || !hap.value || typeof hap.value !== 'object') return hap;
      const value = hap.value as Record<string, unknown>;
      const cps = value.cps;
      if (typeof cps !== 'number') return hap;
      return hap.withValue(() => ({ ...value, cps: cps * factor }));
    }),
  );
}

/** REPL tempo calls must be staged with the captured pattern, without briefly
 * changing a running clock. Depends on REPL setcpm/setcps delegating to this
 * scheduler method. set() is the host path, including Speed during evaluation. */
export function captureTempo(scheduler: { setCps(cps: number): void }) {
  const setCps = scheduler.setCps;
  return {
    set(cps: number) {
      setCps.call(scheduler, cps);
    },
    async during(initial: number, evaluate: () => Promise<void>) {
      let written = initial;
      scheduler.setCps = (cps) => {
        written = cps;
      };
      try {
        await evaluate();
        return written;
      } finally {
        scheduler.setCps = setCps;
      }
    },
  };
}
