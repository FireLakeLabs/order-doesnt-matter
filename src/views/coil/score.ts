import type { ViewFrame, ViewNote } from '../types';

const cache = new WeakMap<ViewNote[], ViewNote[]>();

/** Identical continuations of an onset are one scored note. Coincident onsets,
 * different bags and continuations whose onset is outside the query remain. */
export function coilNotes(notes: ViewNote[]): ViewNote[] {
  const cached = cache.get(notes);
  if (cached) return cached;
  const key = (note: ViewNote) =>
    JSON.stringify([
      note.instrument,
      note.start,
      note.end,
      Object.keys(note.value)
        .sort()
        .map((name) => [name, note.value[name]]),
    ]);
  const onsets = new Set(notes.filter((note) => note.hasOnset).map(key));
  const filtered = notes.filter((note) => note.hasOnset || !onsets.has(key(note)));
  const result = filtered.length === notes.length ? notes : filtered;
  cache.set(notes, result);
  cache.set(result, result);
  return result;
}

/** Shared locally by the rendered strips, pick ribbons and flat reading surface.
 * Host note arrays are immutable; camera/hover frames reuse the filtered array. */
export function coilFrame(frame: ViewFrame): ViewFrame {
  const notes = coilNotes(frame.notes);
  return notes === frame.notes ? frame : { ...frame, notes };
}
