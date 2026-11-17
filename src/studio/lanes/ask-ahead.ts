import type { AppState } from '../../app/state';
import type { CycleLoop } from '../../contract';
import { scoreRange } from './model';

/** Ask only the next followed window. Song repeats use absolute cycles; an
 * explicit transport loop returns to its actual start, possibly mid-section. */
export function scoreAheadRange(
  state: Pick<AppState, 'sections' | 'follow'>,
  now: number,
  playing: boolean,
  loop: CycleLoop | null,
) {
  if (!playing || !state.follow) return null;
  const current = scoreRange(state.sections, now);
  const destination = loop && loop.to <= current.to ? loop.from : current.to;
  const next = scoreRange(state.sections, destination);
  return next.from === current.from && next.to === current.to ? null : next;
}
