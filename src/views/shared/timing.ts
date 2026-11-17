import type { ViewNote } from '../types';
import { clamp } from './math';

/** Latest onset at or before now for an instrument; fragments never count and ties retain input order. */
export function previousOnset(
  notes: readonly ViewNote[],
  instrument: string,
  now: number,
): ViewNote | undefined {
  let result: ViewNote | undefined;
  for (const note of notes)
    if (
      note.instrument === instrument &&
      note.hasOnset &&
      note.start <= now &&
      (!result || note.start > result.start)
    )
      result = note;
  return result;
}
/** Earliest onset strictly after now for an instrument; fragments never count and ties retain input order. */
export function nextOnset(
  notes: readonly ViewNote[],
  instrument: string,
  now: number,
): ViewNote | undefined {
  let result: ViewNote | undefined;
  for (const note of notes)
    if (
      note.instrument === instrument &&
      note.hasOnset &&
      note.start > now &&
      (!result || note.start < result.start)
    )
      result = note;
  return result;
}
/** Unit progress through this scored span, clamped before/after it; zero-length spans step on their start. */
export function noteProgress(note: Pick<ViewNote, 'start' | 'end'>, now: number): number {
  return note.end > note.start
    ? clamp((now - note.start) / (note.end - note.start))
    : Number(now >= note.start);
}
/** Progress of the latest-starting sounding span in [start, end), including fragments; silence returns undefined. */
export function soundingProgress(
  notes: readonly ViewNote[],
  instrument: string,
  now: number,
): number | undefined {
  let result: ViewNote | undefined;
  for (const note of notes)
    if (
      note.instrument === instrument &&
      note.start <= now &&
      now < note.end &&
      (!result || note.start > result.start)
    )
      result = note;
  return result ? noteProgress(result, now) : undefined;
}
/** Unit flight progress from onset minus lookAhead to onset; a nonpositive window steps at onset. */
export function flightProgress(
  note: Pick<ViewNote, 'start'>,
  now: number,
  lookAhead: number,
): number {
  return lookAhead > 0 ? clamp(1 + (now - note.start) / lookAhead) : Number(now >= note.start);
}
