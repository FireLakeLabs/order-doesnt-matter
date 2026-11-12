import { Pattern } from '@strudel/core';
import type { Hap, State, Scheduler } from './index';
import {
  FLOOD_MESSAGE,
  MAX_WINDOW_STARTS,
  PlaybackOverrun,
  QUERY_LIMIT_MS,
} from '../engine/playback-limits';

// Depends on Cyclist querying queryArc (which swallows exceptions): guard direct query first.
export function guarded(
  pattern: Pattern,
  failed: (error: unknown) => void,
  tag: (hap: Hap) => void,
  silent?: (state: State) => void,
): Pattern {
  let flooded = false,
    halted = false;
  return new Pattern((state: State) => {
    if (halted) return [];
    const start = performance.now();
    try {
      const haps = pattern.query(state);
      if (performance.now() - start > QUERY_LIMIT_MS) {
        halted = true;
        failed(new PlaybackOverrun());
        return [];
      }
      // Cyclist 1.2.6, cyclist.mjs:60–76, starts only hasOnset haps.
      // Filtering here bounds both its synchronous loop and asynchronous output.
      const onsets: Hap[] = [];
      let excess = false;
      for (const hap of haps) {
        if (!hap.hasOnset()) continue;
        if (onsets.length === MAX_WINDOW_STARTS) {
          excess = true;
          break;
        }
        onsets.push(hap);
      }
      if (excess && !flooded) {
        flooded = true;
        failed(Error(FLOOD_MESSAGE));
      }
      onsets.forEach(tag);
      if (!onsets.length) silent?.(state);
      return onsets;
    } catch (error) {
      if (performance.now() - start > QUERY_LIMIT_MS) {
        halted = true;
        failed(new PlaybackOverrun());
      } else failed(error);
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
