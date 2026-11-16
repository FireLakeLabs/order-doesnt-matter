import type { ViewFrame, ViewNote } from '../types';
import { clamp, timeline, type Score } from '../shared/retro-2d';
export function rows(f: ViewFrame, score: Score) {
  const time = timeline(f, 0, f.width);
  let low = Infinity,
    high = -Infinity;
  const unpitched: string[] = [];
  for (const instrument of [...f.instruments].sort((a, b) => a.index - b.index)) {
    const events = score.get(instrument.id) ?? [];
    if (!events.length || events.some((e) => e.pitch === undefined)) unpitched.push(instrument.id);
    for (const e of events)
      if (e.pitch !== undefined && e.note.end >= time.from && e.note.start <= time.to) {
        low = Math.min(low, Math.floor(e.pitch));
        high = Math.max(high, Math.ceil(e.pitch));
      }
  }
  const pitches = Number.isFinite(low) ? high - low + 1 : 0;
  const top = 113,
    bottom = f.height - 46;
  const drumHeight = unpitched.length
    ? Math.min((bottom - top) * (pitches ? 0.32 : 1), unpitched.length * 34)
    : 0;
  const split = bottom - drumHeight;
  const keyHeight = pitches ? (split - top) / pitches : 0;
  const drumRow = unpitched.length ? drumHeight / unpitched.length : 0;
  return {
    low,
    high,
    pitches,
    unpitched,
    top,
    bottom,
    split,
    keyHeight,
    drumRow,
    y: (p: number) => top + (high - p + 0.5) * keyHeight,
    drumY: (id: string) => split + (unpitched.indexOf(id) + 0.5) * drumRow,
  };
}

export function trail(note: ViewNote, f: Pick<ViewFrame, 'now' | 'trails' | 'cps'>) {
  if (!note.hasOnset || !f.trails || f.now < note.end) return 0;
  const duration = (f.trails === 2 ? 1.2 : 0.3) * Math.max(0.001, f.cps);
  return clamp(1 - (f.now - note.end) / duration);
}
