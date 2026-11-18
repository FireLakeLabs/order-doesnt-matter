import type { ViewNote } from '../types';

/** Whole-note continuations repeat in the host's cycle queries. Keep genuine
 * coincident onsets and unmatched carries, but do not count an onset's identical
 * continuation as another note. Bag order is not note identity. */
export function scoredNotes(notes: ViewNote[]): ViewNote[] {
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
  return notes.filter((note) => note.hasOnset || !onsets.has(key(note)));
}
