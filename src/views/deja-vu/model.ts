import type { ViewFrame, ViewNote } from '../types';
import { pitch, noteName } from '../shared/pitch';
import { songSummary } from '../shared/song';

const relative = (time: number) => Math.round(time * 1e9) / 1e9;
function canonical(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || typeof value !== 'object') return `${typeof value}:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  );
}
export interface Slice {
  note: ViewNote;
  start: number;
  end: number;
  pitch: number | undefined;
  onset: boolean;
}
export interface Difference {
  key: string;
  before: unknown;
  after: unknown;
}
export interface Entry {
  slice: Slice;
  kind: 'same' | 'changed' | 'new' | 'vanished' | 'unasked';
  before?: Slice;
  after?: Slice;
  differences: Difference[];
}
export function analyse(notes: ViewNote[]) {
  const bars = new Map<number, Slice[]>();
  let from = Infinity,
    to = -Infinity;
  for (const note of notes) {
    const first = Math.floor(note.start),
      last = Math.max(first + 1, Math.ceil(note.end));
    from = Math.min(from, first);
    to = Math.max(to, last);
    for (let bar = first; bar < last; bar++) {
      const entries = bars.get(bar) ?? [];
      entries.push({
        note,
        start: relative(Math.max(note.start, bar) - bar),
        end: relative(Math.min(Math.max(note.end, note.start), bar + 1) - bar),
        pitch: pitch(note.value),
        onset: note.hasOnset && note.start >= bar,
      });
      bars.set(bar, entries);
    }
  }
  return {
    bars,
    summaries: new Map(songSummary(notes, from, to + 1).map((s) => [s.bar, s.change])),
  };
}
export type Score = ReturnType<typeof analyse>;
const signature = (s: Slice) => canonical([s.end, s.onset, s.note.value]);
function differences(before: Slice, after: Slice): Difference[] {
  const result: Difference[] = [];
  const pitched = before.pitch !== undefined && after.pitch !== undefined;
  const source = (s: Slice) =>
    s.note.value.note !== undefined ? 'note' : s.note.value.n !== undefined ? 'n' : 'freq';
  if (before.pitch !== after.pitch)
    result.push({
      key: 'pitch',
      before: before.pitch === undefined ? '∅' : noteName(before.pitch),
      after: after.pitch === undefined ? '∅' : noteName(after.pitch),
    });
  for (const key of new Set(
    [...Object.keys(before.note.value), ...Object.keys(after.note.value)].sort(),
  )) {
    if (pitched && (key === source(before) || key === source(after))) continue;
    const a = before.note.value[key],
      b = after.note.value[key];
    if (canonical(a) !== canonical(b)) result.push({ key, before: a, after: b });
  }
  if (before.end !== after.end)
    result.push({
      key: 'length',
      before: relative(before.end - before.start),
      after: relative(after.end - after.start),
    });
  if (before.onset !== after.onset)
    result.push({ key: 'onset', before: before.onset, after: after.onset });
  return result;
}
function pair(before: Slice, after: Slice): Entry {
  const diff = differences(before, after);
  return { slice: after, kind: diff.length ? 'changed' : 'same', before, after, differences: diff };
}
/** Match instrument/start/pitch first; pair leftover pitches only for exactly one old and one new at that instrument/start, otherwise retain new + vanished. */
export function match(previous: readonly Slice[], current: readonly Slice[]): Entry[] {
  const groups = new Map<string, { old: Slice[]; fresh: Slice[] }>();
  for (const [notes, side] of [
    [previous, 'old'],
    [current, 'fresh'],
  ] as const)
    for (const s of notes) {
      const key = JSON.stringify([s.note.instrument, s.start]);
      const group = groups.get(key) ?? { old: [], fresh: [] };
      group[side].push(s);
      groups.set(key, group);
    }
  const result: Entry[] = [];
  for (const group of groups.values()) {
    const oldLeft: Slice[] = [],
      newLeft: Slice[] = [];
    for (const p of new Set([...group.old, ...group.fresh].map((s) => s.pitch))) {
      const old = group.old
        .filter((s) => s.pitch === p)
        .sort((a, b) => signature(a).localeCompare(signature(b)));
      const fresh = group.fresh
        .filter((s) => s.pitch === p)
        .sort((a, b) => signature(a).localeCompare(signature(b)));
      // Preserve identical voices before pairing settings changes in a unison chord.
      for (let i = old.length - 1; i >= 0; i--) {
        const j = fresh.findIndex((s) => signature(s) === signature(old[i]));
        if (j >= 0) result.push(pair(old.splice(i, 1)[0], fresh.splice(j, 1)[0]));
      }
      while (old.length && fresh.length)
        result.push(pair(old.splice(0, 1)[0], fresh.splice(0, 1)[0]));
      oldLeft.push(...old);
      newLeft.push(...fresh);
    }
    if (oldLeft.length === 1 && newLeft.length === 1)
      result.push(pair(oldLeft.splice(0, 1)[0], newLeft.splice(0, 1)[0]));
    result.push(
      ...oldLeft.map((before) => ({
        slice: before,
        kind: 'vanished' as const,
        before,
        differences: [],
      })),
      ...newLeft.map((after) => ({ slice: after, kind: 'new' as const, after, differences: [] })),
    );
  }
  return result.sort(
    (a, b) => a.slice.start - b.slice.start || (a.slice.pitch ?? -1) - (b.slice.pitch ?? -1),
  );
}
export function knownBar(f: Pick<ViewFrame, 'from' | 'to'>, bar: number) {
  return bar >= f.from && bar + 1 <= f.to;
}
export function comparison(f: ViewFrame, score: Score) {
  const bar = Math.floor(f.now),
    known = knownBar(f, bar) && (bar === 0 || knownBar(f, bar - 1));
  const current = score.bars.get(bar) ?? [],
    previous = bar === 0 ? [] : (score.bars.get(bar - 1) ?? []);
  const entries: Entry[] = known
    ? match(previous, current)
    : current.map((after) => ({ slice: after, kind: 'unasked', after, differences: [] }));
  const rows = f.instruments.map((instrument) => ({
    instrument,
    entries: entries.filter((e) => e.slice.note.instrument === instrument.id),
  }));
  const counts = { new: 0, vanished: 0, changed: 0, same: 0 };
  for (const e of entries) if (e.kind !== 'unasked') counts[e.kind]++;
  return { bar, known, rows, counts, change: known ? (score.summaries.get(bar) ?? 0) : undefined };
}
export function strip(f: ViewFrame, score: Score) {
  const length = f.sections.at(-1)?.to ?? 16;
  const start = Math.floor(f.now / length) * length;
  return Array.from({ length: Math.ceil(length) }, (_, i) => {
    const bar = Math.floor(start) + i;
    return {
      bar,
      change:
        knownBar(f, bar) && (bar === 0 || knownBar(f, bar - 1))
          ? (score.summaries.get(bar) ?? 0)
          : undefined,
    };
  });
}
/** Simultaneous voices, counting each bar separately so a changed pitch is one voice. */
export function voiceCount(entries: readonly Entry[]): number {
  let maximum = 1;
  for (const side of ['before', 'after'] as const) {
    const points = entries
      .flatMap((e) => {
        const s = e[side];
        return s && s.end > s.start
          ? [
              [s.start, 1],
              [s.end, -1],
            ]
          : [];
      })
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let active = 0;
    for (const [, delta] of points) {
      active += delta;
      maximum = Math.max(maximum, active);
    }
  }
  return maximum;
}
/** Allocate simultaneous voices independently in the two bars; equal pitches still occupy distinct lanes. */
export function lanes(entries: readonly Entry[]) {
  const result = new Map<Slice, number>();
  for (const side of ['before', 'after'] as const) {
    const ends: number[] = [];
    const slices = entries
      .flatMap((e) => (e[side] ? [e[side]] : []))
      .sort(
        (a, b) =>
          a.start - b.start ||
          (a.pitch ?? -1) - (b.pitch ?? -1) ||
          signature(a).localeCompare(signature(b)),
      );
    for (const s of slices) {
      let lane = ends.findIndex((end) => end <= s.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = s.end;
      result.set(s, lane);
    }
  }
  return result;
}
export function differenceLabel(d: Difference) {
  let before = valueText(d.before),
    after = valueText(d.after);
  if (before === after && canonical(d.before) !== canonical(d.after)) {
    before = String(d.before);
    after = String(d.after);
  }
  return { key: d.key, before, after };
}
export function layout(f: Pick<ViewFrame, 'width' | 'height'>, count: number) {
  const scale = f.width / 960;
  const left = Math.min(190 * scale, Math.max(100, f.width * 0.16)),
    right = f.width - Math.max(14, 30 * scale);
  const top = Math.min(Math.max(130, 176 * scale), f.height * 0.32),
    bottom = f.height - Math.max(48, 48 * scale);
  const rowHeight = (bottom - top) / Math.max(1, count);
  return {
    scale,
    left,
    right,
    top,
    bottom,
    rowHeight,
    noteHeight: Math.min(
      Math.max(22, 28 * scale, count < 4 ? rowHeight * 0.5 : 0),
      rowHeight * 0.78,
    ),
    font: Math.max(12, 12 * Math.min(scale, 1.5)),
    stripTop: Math.max(
      62,
      Math.min(96 * scale, top - Math.max(18, 26 * Math.min(scale, 1.5)) - 40),
    ),
    stripHeight: Math.max(18, 26 * Math.min(scale, 1.5)),
  };
}
export function valueText(value: unknown): string {
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(3)));
  if (value === undefined) return '∅';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
