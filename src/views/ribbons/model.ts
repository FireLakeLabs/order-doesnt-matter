import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { clamp } from '../shared/math';
import { pitch } from '../shared/pitch';
import { noteProgress } from '../shared/timing';

export const gateX = -60;
export const timeScale = 840;
// At Window 8 the host guarantees four past cycles, including at block edges.
export const pastReach = 0.5;
export const futureReach = 0.65;
const finite = (v: unknown, fallback = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
export function indexRibbons(notes: ViewNote[]) {
  const result = new Map<string, ViewNote[]>();
  const seen = new Set<string>();
  for (const note of notes) {
    if (!note.hasOnset) {
      const key = JSON.stringify([
        note.instrument,
        note.start,
        note.end,
        Object.entries(note.value).sort(),
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    let group = result.get(note.instrument);
    if (!group) result.set(note.instrument, (group = []));
    group.push(note);
  }
  for (const notes of result.values()) notes.sort((a, b) => a.start - b.start || a.end - b.end);
  return result;
}
/** A sampled setting fixes the cross-section's orientation for the whole note. */
export function noteTurn(note: ViewNote, instrument: ViewInstrument) {
  for (const setting of instrument.settings) {
    if (setting.kind !== 'signal' && setting.kind !== 'values') continue;
    if (['note', 'n', 'freq', 's', 'sound'].includes(setting.name)) continue;
    const key =
      setting.name === 'lpf' ? 'cutoff' : setting.name === 'hpf' ? 'hcutoff' : setting.name;
    const value = note.value[key] ?? note.value[setting.name];
    if (typeof value === 'string') {
      let hash = 0;
      for (const char of value) hash = Math.imul(hash, 31) + (char.codePointAt(0) ?? 0);
      return (((hash >>> 0) % 1024) / 512 - 1) * 0.9;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const unit =
      key === 'cutoff' || key === 'hcutoff'
        ? Math.log2(Math.max(1, value) / 500)
        : key === 'gain' || key === 'speed'
          ? (value - 1) * 2
          : value;
    return Math.atan(unit) * 0.65;
  }
  return 0;
}
export const pitchHeight = (midi: number) => -0.2 + 0.2 * Math.tanh((midi - 36) / 16);
/** Admit n as pitch only when authored as a control: s("speech:2") produces a
 * sample index. The shared pitch reader cannot make that distinction alone. */
export function scoredPitch(note: ViewNote, instrument: ViewInstrument) {
  if (
    note.value.note === undefined &&
    note.value.freq === undefined &&
    !instrument.settings.some((s) => s.name === 'n')
  )
    return undefined;
  return pitch(note.value);
}
export function ribbonParts(frame: ViewFrame, score = indexRibbons(frame.notes)) {
  const from = frame.now - frame.lookAhead * pastReach;
  const to = frame.now + frame.lookAhead * futureReach;
  const all = [...frame.instruments].sort((a, b) => a.index - b.index);
  const groups = all.map((instrument) => ({
    instrument,
    notes: (score.get(instrument.id) ?? []).filter(
      (n) => (n.hasOnset || n.start < frame.from) && n.end > n.start,
    ),
  }));
  const shown = groups.filter(
    ({ instrument, notes }) =>
      !frame.sections.length ||
      instrument.inSection ||
      notes.some((n) => n.start < to && n.end > from),
  );
  const drums = shown.filter(
    ({ notes, instrument }) => !notes.some((n) => scoredPitch(n, instrument) !== undefined),
  );
  return shown.map(({ instrument, notes }) => {
    const pitches = notes
      .map((n) => scoredPitch(n, instrument))
      .filter((p): p is number => p !== undefined);
    const unpitched = pitches.length === 0;
    const baseline = unpitched
      ? 0.02 +
        0.4 *
          (1 -
            (drums.findIndex((p) => p.instrument.id === instrument.id) + 0.5) /
              Math.max(1, drums.length))
      : pitchHeight(pitches[Math.floor(pitches.length / 2)]);
    return {
      instrument,
      notes,
      unpitched,
      baseline,
      // Inventory-based depth is stable when a section's other ribbons enter or leave.
      depth:
        all.length > 8
          ? ((all.findIndex((i) => i.id === instrument.id) + 0.5) / all.length - 0.5) * 0.38
          : 0,
    };
  });
}
export type RibbonPart = ReturnType<typeof ribbonParts>[number];
export function noteHeight(part: RibbonPart, note: ViewNote) {
  const midi = scoredPitch(note, part.instrument);
  return midi === undefined ? part.baseline : pitchHeight(midi);
}
export const noteWidth = (part: RibbonPart, note: ViewNote) =>
  (part.unpitched ? 30 : 44) * clamp(finite(note.value.gain, 1), 0, 4);
export function cameraPose(now: number) {
  return { x: Math.sin(now * 0.075) * 0.012, y: Math.cos(now * 0.055) * 0.01 };
}
export function ribbonAt(part: RibbonPart, time: number) {
  const active = part.notes.filter((n) => n.start <= time && time < n.end);
  if (active.length)
    return {
      count: active.length,
      height: active.reduce((sum, n) => sum + noteHeight(part, n), 0) / active.length,
      turn: noteTurn(active[active.length - 1], part.instrument),
      width: active.reduce((width, n) => Math.max(width, noteWidth(part, n)), 0),
    };
  let before: ViewNote | undefined, after: ViewNote | undefined;
  for (const note of part.notes) {
    if (note.end <= time && (!before || note.end > before.end)) before = note;
    if (note.start > time && (!after || note.start < after.start)) after = note;
  }
  const a = before ? noteHeight(part, before) : after ? noteHeight(part, after) : part.baseline;
  const b = after ? noteHeight(part, after) : a;
  const progress =
    before && after ? noteProgress({ start: before.end, end: after.start }, time) : 0;
  return {
    count: 0,
    height: a + (b - a) * progress,
    turn: before ? noteTurn(before, part.instrument) : 0,
    width: 0,
  };
}

export interface RibbonGeometry {
  positions: Float32Array;
  edges: Float32Array;
  marks: Float32Array;
  indices: number[];
  spans: number;
  threads: number;
}
/** Cached score geometry. Every span has its own surface, including coincident voices. */
export function ribbonGeometry(frame: ViewFrame, parts = ribbonParts(frame)): RibbonGeometry {
  const positions: number[] = [],
    edges: number[] = [],
    marks: number[] = [],
    indices: number[] = [];
  let spans = 0;
  function strip(
    part: RibbonPart,
    points: { time: number; height: number; turn: number }[],
    width: number,
    kind: number,
  ) {
    const start = positions.length / 3;
    for (const point of points)
      for (const side of [-1, 0, 1]) {
        positions.push(point.time - frame.from, point.height, part.depth);
        edges.push(side, width, point.turn);
        marks.push(kind, part.instrument.index, part.instrument.muted ? 0.2 : 1);
      }
    for (let t = 0; t < points.length - 1; t++)
      for (let side = 0; side < 2; side++) {
        const a = start + t * 3 + side,
          b = a + 3;
        indices.push(a, b, b + 1, a, b + 1, a + 1);
      }
  }
  for (const part of parts) {
    const knots = new Set([frame.from, frame.to]);
    for (let time = Math.ceil(frame.from * 8) / 8; time < frame.to; time += 1 / 8) knots.add(time);
    for (const note of part.notes) {
      knots.add(Math.max(frame.from, note.start));
      knots.add(Math.min(frame.to, note.end));
    }
    const points = [...knots]
      .filter((t) => t >= frame.from && t <= frame.to)
      .sort((a, b) => a - b)
      .flatMap((time) => {
        const point = { time, ...ribbonAt(part, time) };
        if (time === frame.from) return [point];
        const before = { time, ...ribbonAt(part, time - 1e-8) };
        // Duplicate the knot at a fold; never interpolate a new sampled turn
        // into the preceding held note or rest.
        return Math.abs(before.height - point.height) > 1e-7 || before.turn !== point.turn
          ? [before, point]
          : [point];
      });
    strip(part, points, 0, 0);
    for (const note of part.notes) {
      const start = Math.max(frame.from, note.start),
        end = Math.min(frame.to, note.end);
      if (end <= start) continue;
      spans++;
      const steps = Math.max(1, Math.min(64, Math.ceil((end - start) * 12)));
      const points = Array.from({ length: steps + 1 }, (_, i) => ({
        time: start + ((end - start) * i) / steps,
        height: noteHeight(part, note),
        turn: noteTurn(note, part.instrument),
      }));
      strip(part, points, noteWidth(part, note), 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    edges: new Float32Array(edges),
    marks: new Float32Array(marks),
    indices,
    spans,
    threads: parts.length,
  };
}
