import type { ViewFrame, ViewNote } from '../types';
import { pitch, noteName } from '../shared/pitch';
import { scoredNotes } from '../shared/scored-notes';
import { settingRanges } from '../shared/settings';
import { clamp } from '../shared/math';

// As in Staff and Chord bridge: scaled degrees have resolved to note; bare n is a sample index.
export const readPitch = (note: ViewNote) => pitch({ ...note.value, n: undefined });
export function scoreRange(frame: ViewFrame): [number, number] {
  const length = frame.sections.at(-1)?.to ?? 16;
  const from = Math.max(0, Math.floor(frame.now / length)) * length;
  return [from, from + length];
}
export const markKind = (length: number) =>
  length <= 1 / 16 ? 'dot' : length <= 1 / 4 ? 'cross' : 'tick';
export interface MovingSetting {
  name: string;
  min: number;
  max: number;
}
export interface ScorePart {
  id: string;
  name: string;
  moving: MovingSetting[];
  heldCutoff?: number;
  unpitched: boolean;
}
export interface Mark {
  note: ViewNote;
  kind: 'line' | 'dot' | 'cross' | 'tick';
  midi?: number;
  from: number;
  to: number;
  carried: boolean;
  gain: number;
  room: number;
  waves: { name: string; value: number; width: number }[];
}
const numeric = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
export function graphicScore(frame: ViewFrame) {
  const [from, to] = scoreRange(frame);
  const carries = new Set<string>();
  const notes = scoredNotes(frame.notes)
    .filter((n) => {
      if (n.start >= Math.min(to, frame.to) || n.end <= Math.max(from, frame.from)) return false;
      if (n.hasOnset) return true;
      const key = JSON.stringify([
        n.instrument,
        n.start,
        n.end,
        Object.entries(n.value).sort(([a], [b]) => a.localeCompare(b)),
      ]);
      if (carries.has(key)) return false;
      carries.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        a.instrument.localeCompare(b.instrument) ||
        JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)),
    );
  const parts: ScorePart[] = frame.instruments
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((i) => {
      const own = notes.filter((n) => n.instrument === i.id);
      const ranges = settingRanges(own);
      // Pitch and sample/room identity have their own coordinates, rather than a control envelope.
      const excluded = new Set(['note', 'n', 'freq', 's', 'sound', 'orbit']);
      const moving = [...ranges].flatMap(([name, r]) =>
        !excluded.has(name) && r.min !== undefined && r.max !== undefined && r.max - r.min > 1e-6
          ? [{ name, min: r.min, max: r.max }]
          : [],
      );
      const cutoff = ranges.get('cutoff') ?? ranges.get('lpf');
      return {
        id: i.id,
        name: i.name,
        moving,
        heldCutoff:
          cutoff?.min !== undefined && cutoff.max !== undefined && cutoff.max - cutoff.min <= 1e-6
            ? cutoff.min
            : undefined,
        unpitched: own.some((n) => readPitch(n) === undefined),
      };
    });
  const byId = new Map(parts.map((p) => [p.id, p]));
  const marks: Mark[] = [];
  const counts = { line: 0, dot: 0, cross: 0, tick: 0, zigzag: 0, halo: 0, carried: 0 };
  for (const note of notes) {
    const midi = readPitch(note),
      part = byId.get(note.instrument);
    const kind = midi === undefined ? markKind(note.end - note.start) : 'line';
    const room = clamp(numeric(note.value.room, 0));
    const waves = (part?.moving ?? []).flatMap((s) => {
      const value = numeric(note.value[s.name], NaN);
      return Number.isFinite(value)
        ? [{ name: s.name, value, width: clamp((value - s.min) / (s.max - s.min)) }]
        : [];
    });
    counts[kind]++;
    counts.zigzag += waves.length;
    counts.halo += Number(room > 0);
    const start = Math.max(from, frame.from, note.start),
      end = Math.min(to, frame.to, note.end);
    for (let bar = Math.floor(start); bar < end; bar++) {
      const a = Math.max(start, bar),
        b = Math.min(end, bar + 1);
      const carried = note.start < a || !note.hasOnset;
      counts.carried += Number(carried);
      marks.push({
        note,
        kind,
        midi,
        from: a,
        to: b,
        carried,
        gain: Math.max(0, numeric(note.value.gain, 1)),
        room,
        waves,
      });
    }
  }
  const pitches = marks.flatMap((m) => (m.midi === undefined ? [] : [m.midi]));
  const low = pitches.length
    ? Math.floor(pitches.reduce((a, b) => Math.min(a, b), Infinity) / 12) * 12
    : 36;
  const high = pitches.length
    ? Math.max(low + 12, Math.ceil(pitches.reduce((a, b) => Math.max(a, b), -Infinity) / 12) * 12)
    : 60;
  const panels = frame.sections.length
    ? frame.sections.map((s) => ({ ...s, from: s.from + from, to: s.to + from }))
    : Array.from({ length: 4 }, (_, i) => ({
        name: 'Cycles',
        from: from + i * 4,
        to: from + (i + 1) * 4,
      }));
  return {
    from,
    to,
    parts,
    notes,
    marks,
    counts,
    panels,
    low,
    high,
    pitched: pitches.length > 0,
  };
}
export type GraphicScore = ReturnType<typeof graphicScore>;
export function posterLayout(
  score: GraphicScore,
  width: number,
  height: number,
  measure: (text: string) => number = (text) => text.length * 11,
) {
  const narrow = width < 700,
    margin = narrow ? 18 : 30;
  const columns = Math.max(1, Math.floor((width - 2 * margin) / (narrow ? 215 : 245)));
  const partRows = Math.min(Math.ceil(score.parts.length / columns), narrow ? 5 : 3);
  const footer = partRows * 18 + (narrow ? 68 : 52);
  const drumParts = score.parts.filter((p) => p.unpitched);
  const gutter = Math.max(42, ...drumParts.map((p) => measure(p.name) + 8));
  const left = margin + gutter,
    right = width - margin,
    top = 110;
  const bottom = Math.max(top + 50, height - footer - 18);
  const drumHeight = drumParts.length
    ? score.pitched
      ? Math.min((bottom - top) * 0.7, Math.max((bottom - top) * 0.42, drumParts.length * 15 + 14))
      : bottom - top - 8
    : 0;
  const pitchBottom = score.pitched ? bottom - drumHeight - 12 : top - 4;
  const x = (t: number) => left + ((t - score.from) / (score.to - score.from)) * (right - left);
  const y = (midi: number) =>
    pitchBottom -
    ((midi - score.low) / Math.max(12, score.high - score.low)) * (pitchBottom - top - 12);
  const octaveStep = Math.max(
    1,
    Math.ceil(16 / Math.max(1, Math.abs(y(score.low + 12) - y(score.low)))),
  );
  return {
    margin,
    left,
    right,
    top,
    bottom,
    pitchBottom,
    footer,
    columns,
    partRows,
    drumParts,
    x,
    y,
    drumY: (id: string) =>
      pitchBottom +
      19 +
      (drumParts.findIndex((p) => p.id === id) + 0.5) *
        Math.max(1, (drumHeight - 14) / Math.max(1, drumParts.length)),
    pitchLabels: score.pitched
      ? Array.from(
          { length: Math.floor((score.high - score.low) / (12 * octaveStep)) + 1 },
          (_, i) => score.low + i * 12 * octaveStep,
        ).map((midi) => ({ midi, label: noteName(midi) }))
      : [],
  };
}
export type PosterLayout = ReturnType<typeof posterLayout>;
