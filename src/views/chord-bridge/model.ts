import type { ViewFrame, ViewNote } from '../types';
import { pitch, noteName } from '../shared/pitch';
import { roleEvidence } from '../shared/roles';
import { clamp } from '../shared/math';

export interface Tone {
  note: ViewNote;
  midi: number;
}
export interface Pier {
  start: number;
  end: number;
  tones: Tone[];
  carried: boolean;
}
export interface Bridge {
  chord?: string;
  melody?: string;
  piers: Pier[];
  tones: Tone[];
  notes: ViewNote[];
}
// Bare n is a sample index; Strudel resolves scaled degrees into note.
export const readPitch = (value: ViewNote['value']) => pitch({ ...value, n: undefined });
export const pitchLabel = (midi: number) =>
  noteName(midi) + (Math.abs(midi - Math.round(midi)) > 1e-6 ? '~' : '');

/** Roles come from simultaneous distinct pitches, then mean pitch, never part names. */
export function analyse(notes: ViewNote[]): Bridge {
  const spans = new Map<string, { onsets: ViewNote[]; carried: Map<string, ViewNote> }>();
  for (const note of notes) {
    const key = JSON.stringify([note.instrument, note.start, note.end]);
    let span = spans.get(key);
    if (!span) spans.set(key, (span = { onsets: [], carried: new Map() }));
    if (note.hasOnset) span.onsets.push(note);
    else {
      const identity = JSON.stringify([readPitch(note.value), note.value.s, note.value.n]);
      if (!span.carried.has(identity)) span.carried.set(identity, note);
    }
  }
  // One held whole span may arrive once per queried cycle. Real simultaneous
  // onsets remain separate, including exact unisons; continuation copies do not.
  notes = [...spans.values()].flatMap((s) =>
    s.onsets.length ? s.onsets : [...s.carried.values()],
  );
  const clean = notes.map((n) => ({ ...n, value: { ...n.value, n: undefined } }));
  const evidence = roleEvidence(clean);
  const groups = new Map<string, Map<number, Tone[]>>();
  const tones: Tone[] = [];
  for (const note of notes) {
    const midi = readPitch(note.value);
    if (midi === undefined || note.end <= note.start) continue;
    const tone = { note, midi };
    tones.push(tone);
    let starts = groups.get(note.instrument);
    if (!starts) groups.set(note.instrument, (starts = new Map<number, Tone[]>()));
    const chord = starts.get(note.start) ?? [];
    chord.push(tone);
    starts.set(note.start, chord);
  }
  const candidates = [...groups].map(([id, starts]) => ({
    id,
    polyphony: [...starts.values()].reduce(
      (sum, chord) => sum + Math.max(0, new Set(chord.map((t) => t.midi)).size - 1),
      0,
    ),
  }));
  const chord = candidates
    .filter((p) => p.polyphony > 0)
    .sort((a, b) => b.polyphony - a.polyphony || a.id.localeCompare(b.id))
    .at(0)?.id;
  const melody = [...evidence.values()]
    .filter((p) => p.id !== chord && Number.isFinite(p.meanPitch))
    .sort((a, b) => b.meanPitch - a.meanPitch || a.id.localeCompare(b.id))
    .at(0)?.id;
  const piers = [...(groups.get(chord ?? '') ?? [])]
    .sort(([a], [b]) => a - b)
    .map(([start, tones]) => ({
      start,
      end: Math.max(...tones.map((t) => t.note.end)),
      tones: tones.sort((a, b) => a.midi - b.midi || a.note.end - b.note.end),
      carried: tones.every((t) => !t.note.hasOnset),
    }));
  return { chord, melody, piers, tones, notes };
}

export function nearest(pier: Pier, next: Pier) {
  const sources = [...new Set(pier.tones.map((t) => t.midi))];
  const targets = [...new Set(next.tones.map((t) => t.midi))].sort((a, b) => a - b);
  return sources.flatMap((from) => {
    let lo = 0,
      hi = targets.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (targets[mid] < from) lo = mid + 1;
      else hi = mid;
    }
    const choices = targets.slice(Math.max(0, lo - 1), lo + 1);
    const distance = Math.min(...choices.map((to) => Math.abs(to - from)));
    const tied = choices.filter((to) => Math.abs(Math.abs(to - from) - distance) < 1e-6);
    return tied.map((to) => ({ from, to, delta: to - from, tie: tied.length > 1 }));
  });
}

export function windowAt(frame: Pick<ViewFrame, 'now' | 'lookAhead'>) {
  const from = Math.max(0, Math.floor(frame.now) - Number(frame.lookAhead > 1));
  return { from, to: from + Math.max(1, frame.lookAhead) };
}
export function stateAt(bridge: Bridge, frame: ViewFrame) {
  const range = windowAt(frame);
  const overlaps = (n: ViewNote) => n.start < range.to && n.end > range.from;
  const piers = bridge.piers.filter((p) => p.start < range.to && p.end > range.from);
  const melody = bridge.tones.filter(
    (t) => t.note.instrument === bridge.melody && overlaps(t.note),
  );
  const others = bridge.notes.filter(
    (n) =>
      overlaps(n) &&
      (readPitch(n.value) === undefined ||
        (n.instrument !== bridge.chord && n.instrument !== bridge.melody)),
  );
  const counts = new Map<string, { total: number; active: number }>();
  for (const n of others) {
    const row = counts.get(n.instrument) ?? { total: 0, active: 0 };
    row.total++;
    row.active += Number(n.start <= frame.now && frame.now < n.end);
    counts.set(n.instrument, row);
  }
  return { ...range, piers, melody, others, counts };
}

/** Fixed pitch axis: sibling starts/ends cannot move a held pitch. Edge bands count overflow. */
export function layout(width: number, height: number, range: { from: number; to: number }) {
  const side = width < 700 ? 124 : 186;
  const left = 48,
    right = Math.max(left + 40, width - side - 32);
  const top = 205,
    bottom = Math.max(top + 55, height - 100);
  const scale = (bottom - top) / 60;
  const y = (midi: number) => bottom - clamp((midi - 24) / 60) * (bottom - top);
  return {
    left,
    right,
    side,
    top,
    bottom,
    scale,
    x: (time: number) =>
      left + ((time - range.from + 0.25) / (range.to - range.from)) * (right - left),
    y,
    // Fixed 24px label bands leave exact-height ticks and span endpoints visible.
    band: (midi: number) => Math.floor((y(midi) - top) / 24),
    bandY: (band: number) => top + band * 24 + 12,
  };
}
export type Layout = ReturnType<typeof layout>;
export function blocks(tones: Tone[], box: Layout) {
  const bins = new Map<number, Tone[]>();
  for (const tone of tones) {
    const band = box.band(tone.midi);
    const bin = bins.get(band) ?? [];
    bin.push(tone);
    bins.set(band, bin);
  }
  return [...bins].map(([band, tones]) => {
    const pitches = [...new Set(tones.map((t) => t.midi))].sort((a, b) => a - b);
    const overflow = pitches.some((p) => p < 24 || p > 84);
    return {
      y: box.bandY(band),
      tones,
      label:
        pitches.length === 1 && !overflow
          ? `${pitchLabel(pitches[0])}${tones.length > 1 ? ` ×${String(tones.length)}` : ''}`
          : `×${String(tones.length)}${overflow ? ' edge' : ''}`,
    };
  });
}
