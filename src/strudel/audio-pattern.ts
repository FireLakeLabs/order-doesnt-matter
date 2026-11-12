import { Pattern } from '@strudel/core';
import type { Hap, State, Scheduler } from './index';

// Depends on Cyclist querying queryArc (which swallows exceptions): guard direct query first.
export function guarded(
  pattern: Pattern,
  failed: (error: unknown) => void,
  tag: (hap: Hap) => void,
  silent?: (state: State) => void,
): Pattern {
  return new Pattern((state: State) => {
    try {
      const haps = pattern.query(state);
      haps.forEach(tag);
      if (!haps.some((hap) => hap.hasOnset())) silent?.(state);
      return haps;
    } catch (error) {
      failed(error);
      return [];
    }
  });
}

// Depends on Cyclist querying State.span at its phase anchors and using this exact
// target-time equation (including latency). The browser silent-swap canary compares
// an onset-free boundary with a real trigger on the same running clock.
export function schedulingBoundary(scheduler: Scheduler, state: State) {
  const cycle = Number(state.span.begin);
  const time =
    (cycle - scheduler.num_cycles_at_cps_change) / scheduler.cps +
    scheduler.seconds_at_cps_change +
    scheduler.latency;
  if (!Number.isFinite(cycle) || !Number.isFinite(time))
    throw Error('Strudel scheduling boundary must have finite cycle and audio time');
  return { cycle, time };
}
