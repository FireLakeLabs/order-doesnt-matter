import { useEffect, useState } from 'react';
import type { SheetModel } from '../../sheet/model';
import { createBrowserQueries } from '../../strudel/evaluate-browser';
import type { EventResult } from '../../contract';
import type { StudioClock } from '../clock';
import { runtime } from '../runtime';
import { createScoreCache } from '../score-cache';
import { scoreRange } from './model';
import { scoreModel } from './score-model';

export interface StudioScore {
  model: SheetModel | null;
  events: Record<string, EventResult>;
  from: number;
  to: number;
  name: string;
  ready: boolean;
  error: string;
}
const emptyEvents: Record<string, EventResult> = {};
export function useScore(clock: StudioClock) {
  const [score, setScore] = useState<StudioScore>({
    model: null,
    events: {},
    from: 0,
    to: 4,
    name: 'Score',
    ready: false,
    error: '',
  });
  useEffect(() => {
    const queries = createBrowserQueries();
    const cache = createScoreCache(queries.query);
    let previous: unknown[] = [];
    let retained: { key: string; events: StudioScore['events'] } | null = null;
    let requested: { doc: typeof runtime.app.state.doc; from: number; to: number } | null = null;
    const unsubscribe = clock.subscribe(({ now }) => {
      const state = runtime.app.state;
      const range = scoreRange(state.sections, now);
      if (
        !requested ||
        requested.doc !== state.doc ||
        requested.from !== range.from ||
        requested.to !== range.to
      ) {
        // Rapid scrubbing abandons obsolete questions instead of queuing every
        // section crossed. This pool belongs only to the score region.
        queries.cancel();
        requested = { doc: state.doc, ...range };
      }
      cache.request(state, range);
      const fresh =
        state.rows.length > 0 &&
        state.rows.every((row) => Object.hasOwn(cache.score.events, row.id)) &&
        cache.score.from === range.from &&
        cache.score.to === range.to;
      const keyForWindow = JSON.stringify([
        runtime.app.activation,
        range.from,
        range.to,
        state.rows.map((row) => row.id),
      ]);
      if (retained?.key !== keyForWindow) retained = null;
      if (fresh) retained = { key: keyForWindow, events: cache.score.events };
      const ready = retained !== null;
      const events = retained?.events ?? emptyEvents;
      const key = [state.doc, state.sounds, events, range.from, range.to, cache.error];
      // React sees document/window/answer changes only; time drawing uses the clock directly.
      if (key.every((value, i) => value === previous[i])) return;
      previous = key;
      const input = state.doc
        ? {
            doc: state.doc,
            events,
            sounds: state.sounds,
            fromCycle: range.from,
            toCycle: range.to,
            playhead: now,
          }
        : null;
      const model = input ? scoreModel(input) : null;
      setScore({ ...range, ready, error: cache.error, events, model });
    });
    return () => {
      unsubscribe();
      cache.dispose();
      queries.cancel();
    };
  }, [clock]);
  return score;
}
