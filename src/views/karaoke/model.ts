import type { ViewFrame, ViewNote } from '../types';
import { clamp } from '../shared/math';
import { pitch, noteName } from '../shared/pitch';
import { previousOnset, nextOnset, noteProgress } from '../shared/timing';

export interface Word {
  note: ViewNote;
  text: string;
  gain: number;
  spans: ViewNote[];
}
export interface Part {
  words: Word[];
  onsets: ViewNote[];
}
export function text(note: ViewNote): string {
  const p = pitch(note.value);
  if (p !== undefined) {
    const fraction = p - Math.round(p);
    return (
      noteName(p) +
      (Math.abs(fraction) > 1e-6
        ? ` ${fraction > 0 ? '+' : ''}${String(Number(fraction.toFixed(3)))}`
        : '')
    );
  }
  const sound = note.value.s ?? note.value.sound ?? note.value.sample;
  return typeof sound === 'string' || typeof sound === 'number' ? String(sound) : 'note';
}
export function gain(note: ViewNote) {
  const g = Number(note.value.gain ?? 1);
  return Number.isFinite(g) ? clamp(g, 0, 4) : 1;
}
/** One word per onset/held span; identical continuation records attach to a word, never create an onset, and remain counted in spans. */
export function analyse(notes: ViewNote[]): Map<string, Part> {
  const result = new Map<string, Part>(),
    continuations = new Map<string, Word>();
  for (const note of [...notes.filter((n) => n.hasOnset), ...notes.filter((n) => !n.hasOnset)]) {
    const part = result.get(note.instrument) ?? { words: [], onsets: [] };
    result.set(note.instrument, part);
    const label = text(note),
      g = gain(note),
      key = JSON.stringify([note.instrument, note.start, note.end, label, g]);
    const existing = !note.hasOnset && continuations.get(key);
    if (existing) existing.spans.push(note);
    else {
      const word = { note, text: label, gain: g, spans: [note] };
      part.words.push(word);
      if (!continuations.has(key)) continuations.set(key, word);
    }
    if (note.hasOnset) part.onsets.push(note);
  }
  for (const part of result.values()) {
    part.words.sort((a, b) => a.note.start - b.note.start || a.text.localeCompare(b.text));
    part.onsets.sort((a, b) => a.start - b.start);
  }
  return result;
}
export const overlaps = (word: Word, bar: number) =>
  word.note.start < bar + 1 && (word.note.end > bar || word.note.start >= bar);
export function lyrics(f: ViewFrame, score: ReadonlyMap<string, Part>) {
  const bar = Math.floor(f.now),
    length = f.sections.at(-1)?.to;
  const local = length ? ((bar % length) + length) % length : bar;
  const section = f.sections.find((s) => local >= s.from && local < s.to);
  const rows = f.instruments
    .map((instrument) => {
      const part = score.get(instrument.id) ?? { words: [], onsets: [] };
      return {
        instrument,
        part,
        words: part.words.filter((w) => overlaps(w, bar)),
        next: part.words.filter((w) => overlaps(w, bar + 1)),
      };
    })
    .filter((r) => r.words.length || r.next.length);
  return {
    bar,
    rows,
    section,
    sectionBar: section ? Math.floor(local - section.from) + 1 : undefined,
    sectionBars: section ? Math.ceil(section.to - section.from) : undefined,
    known: bar >= f.from && bar + 1 <= f.to,
    nextKnown: bar + 1 >= f.from && bar + 2 <= f.to,
  };
}
export function layout(f: Pick<ViewFrame, 'width' | 'height'>, count: number) {
  const scale = f.width / 960,
    compact = count > 12;
  const left = Math.max(120, 150 * scale),
    right = Math.max(left + 1, f.width - Math.max(20, 60 * scale));
  const top = compact
    ? Math.min(105, f.height * 0.22)
    : Math.min(Math.max(100, 158 * scale), f.height * 0.32);
  const bottom = f.height - (compact ? 80 : Math.max(110, 86 * scale));
  const rowHeight = Math.max(1, (bottom - top) / Math.max(1, count));
  const boost = Math.min(2.5, Math.max(1, Math.sqrt(6 / Math.max(1, count))));
  return {
    scale,
    left,
    right,
    top,
    bottom,
    rowHeight,
    boost,
    compact,
    nameSize: compact ? 12 : Math.max(12, 12 * Math.min(scale, 1.5)),
    x: (time: number, bar: number) => left + (time - bar) * (right - left),
  };
}
export type Geometry = ReturnType<typeof layout>;
export function fontSize(g: Geometry, value: number) {
  return Math.max(20, (20 + 12 * Math.sqrt(value)) * g.scale * g.boost);
}
export function previewFontSize(g: Geometry, value: number) {
  return Math.max(12, fontSize({ ...g, boost: 1 }, value) * 0.55);
}
export function crowded(
  words: readonly Word[],
  bar: number,
  g: Geometry,
  measure: (text: string, size: number) => number,
  sizeForGain: (value: number) => number = (value) => fontSize(g, value),
) {
  if (g.rowHeight < 22 || words.some((w) => sizeForGain(w.gain) > g.rowHeight * 1.8)) return true;
  const starts = words.filter((w) => w.note.start >= bar);
  for (let i = 0; i < starts.length; i++) {
    const word = starts[i],
      size = sizeForGain(word.gain),
      width = measure(word.text, size);
    const available = (starts[i + 1]?.note.start ?? bar + 1) - word.note.start;
    if (
      width > (bar + 1 - word.note.start) * (g.right - g.left) ||
      (i + 1 < starts.length && width + size * 1.8 > available * (g.right - g.left))
    )
      return true;
  }
  return false;
}
export function hop(part: Part, instrument: string, now: number, g: Geometry) {
  const previous = previousOnset(part.onsets, instrument, now);
  if (!previous) return undefined;
  const next = nextOnset(part.onsets, instrument, now);
  const gap = next ? next.start - previous.start : 0;
  const progress = next ? noteProgress({ start: previous.start, end: next.start }, now) : 0;
  const height = Math.min(
    g.rowHeight * 0.6,
    32 * Math.sqrt(gap) * g.scale * g.boost * Math.min(1, g.rowHeight / (58 * g.scale * g.boost)),
  );
  return {
    previous,
    next,
    gap,
    progress,
    height,
    rise: 4 * height * progress * (1 - progress),
    time: next ? now : previous.start,
  };
}
