import type { ViewFrame, ViewInstrument, ViewNote, ViewSetting } from '../types';
import { clamp } from '../shared/math';
import { pitch } from '../shared/pitch';
import { settingRanges, type SettingRange } from '../shared/settings';

const aliases: Record<string, string> = {
  lpf: 'cutoff',
  hpf: 'hcutoff',
  roomsize: 'size',
  lpq: 'resonance',
  sound: 's',
};
export const keyFor = (name: string) => (Object.hasOwn(aliases, name) ? aliases[name] : name);
export interface PartIndex {
  notes: ViewNote[];
  onsets: ViewNote[];
  ends: number[];
  ranges: Map<string, SettingRange>;
  textWidths: Map<string, number>;
}
export type TubeIndex = Map<string, PartIndex>;
function rangeValue(value: unknown, name: string): unknown {
  if (name === 'note') value = pitch({ note: value }) ?? value;
  // Structured controls have value semantics, not allocation identity.
  return typeof value === 'number' ? value : `${typeof value}:${JSON.stringify(value)}`;
}

/** One analysis per immutable score, including song ranges and sorted histories. */
export function indexTubes(notes: ViewNote[]): TubeIndex {
  const groups = new Map<string, ViewNote[]>();
  const identity = (n: ViewNote) =>
    JSON.stringify([
      n.instrument,
      n.start,
      n.end,
      Object.keys(n.value)
        .sort()
        .map((k) => [k, n.value[k]]),
    ]);
  const onsets = new Set(notes.filter((n) => n.hasOnset).map(identity));
  for (const note of notes) {
    if (!note.hasOnset && onsets.has(identity(note))) continue;
    const value: ViewNote['value'] = {};
    for (const [name, v] of Object.entries(note.value)) {
      const key = keyFor(name);
      // An explicitly supplied canonical key takes precedence over its alias.
      if (key === name || !Object.hasOwn(note.value, key)) value[key] = v;
    }
    let group = groups.get(note.instrument);
    if (!group) groups.set(note.instrument, (group = []));
    group.push({ ...note, value });
  }
  const result: TubeIndex = new Map();
  for (const [id, group] of groups) {
    group.sort((a, b) => a.start - b.start || a.end - b.end);
    let end = -Infinity;
    const textWidths = new Map<string, number>();
    for (const n of group)
      for (const [key, value] of Object.entries(n.value))
        textWidths.set(key, Math.max(textWidths.get(key) ?? 1, valueText(value).length));
    result.set(id, {
      notes: group,
      onsets: group.filter((n) => n.hasOnset),
      ends: group.map((n) => (end = Math.max(end, n.end))),
      textWidths,
      ranges: settingRanges(
        group.map((n) => ({
          ...n,
          value: Object.fromEntries(
            Object.entries(n.value)
              .filter(([, value]) => value !== undefined)
              .map(([name, value]) => [name, rangeValue(value, name)]),
          ),
        })),
      ),
    });
  }
  return result;
}
function upperBound<T>(items: readonly T[], value: number, read: (item: T) => number): number {
  let lo = 0,
    hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (read(items[mid]) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export interface RackSample {
  active: ViewNote[];
  retained: ViewNote[];
  last: ViewNote | undefined;
  history: ViewNote[];
}
/** Read only overlapping spans and the latest sixteen actual onsets. No visited-time state. */
export function sampleRack(part: PartIndex | undefined, now: number): RackSample {
  if (!part) return { active: [], retained: [], last: undefined, history: [] };
  const stop = upperBound(part.notes, now, (n) => n.start);
  const from = upperBound(part.ends, now, (end) => end);
  const active: ViewNote[] = [];
  for (let i = from; i < stop; i++) if (part.notes[i].end > now) active.push(part.notes[i]);
  const count = upperBound(part.onsets, now, (n) => n.start);
  const last = active.at(-1) ?? (stop > 0 ? part.notes[stop - 1] : undefined);
  const retained: ViewNote[] = [];
  if (last && !active.length)
    for (let i = stop - 1; i >= 0 && part.notes[i].start === last.start; i--)
      retained.unshift(part.notes[i]);
  return {
    active,
    retained,
    last,
    history: part.onsets.slice(Math.max(0, count - 16), count),
  };
}
export function valueText(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(Number(value.toFixed(3))) : String(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
}
export function movingRange(range: SettingRange | undefined): boolean {
  return (
    !!range &&
    ((range.min !== undefined && !flatNumeric(range)) ||
      range.values.size > 1 ||
      (range.min !== undefined && range.values.size > 0))
  );
}
/** Signal evaluation leaves tiny floating errors at identical phases; these
 * must not turn a fixed sampled value into a full-height animated range. */
function flatNumeric(range: SettingRange): boolean {
  return (
    range.min !== undefined &&
    range.max !== undefined &&
    range.max - range.min <= Math.max(1, Math.abs(range.min), Math.abs(range.max)) * 1e-9
  );
}
export function levelOf(
  value: unknown,
  range: SettingRange | undefined,
  name = '',
): number | undefined {
  if (!range || value === undefined) return undefined;
  value = rangeValue(value, name);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || range.min === undefined || range.max === undefined)
      return undefined;
    return flatNumeric(range) ? 0.5 : clamp((value - range.min) / (range.max - range.min));
  }
  const values = [...range.values];
  const i = values.indexOf(value);
  return i < 0 ? undefined : values.length === 1 ? 0.5 : i / (values.length - 1);
}
export interface Tube {
  setting: ViewSetting;
  range: SettingRange | undefined;
  moving: boolean;
  level: number | undefined;
  low: number | undefined;
  text: string;
  valueWidth: number;
  ticks: (number | undefined)[];
  sample: ViewNote | undefined;
  count: number;
  missing: number;
}
/** Simultaneous values form a band, with explicit occupancy rather than a dropped voice. */
export function tubeAt(part: PartIndex | undefined, setting: ViewSetting, rack: RackSample): Tube {
  const key = keyFor(setting.name);
  const range = part?.ranges.get(key);
  const notes = rack.active.length ? rack.active : rack.retained;
  const values = notes.map((n) => n.value[key]);
  const present = values.filter((v) => v !== undefined);
  const levels = present.flatMap((v) => {
    const l = levelOf(v, range, key);
    return l === undefined ? [] : [l];
  });
  const distinct = [...new Set(present.map(valueText))];
  const numeric = present.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const text =
    distinct.length <= 1
      ? (distinct[0] ?? '—')
      : numeric.length === present.length
        ? `${valueText(Math.min(...numeric))}…${valueText(Math.max(...numeric))}`
        : `${String(distinct.length)} values`;
  return {
    setting,
    range,
    moving: movingRange(range),
    level: levels.length ? Math.max(...levels) : undefined,
    low: levels.length ? Math.min(...levels) : undefined,
    text,
    valueWidth: part?.textWidths.get(key) ?? 1,
    ticks: rack.history.map((n) => levelOf(n.value[key], range, key)),
    sample: rack.last,
    count: notes.length,
    missing: values.length - present.length,
  };
}
export interface Rack {
  instrument: ViewInstrument;
  sample: RackSample;
  tubes: Tube[];
}
export function racks(frame: ViewFrame, index: TubeIndex): Rack[] {
  return [...frame.instruments]
    .sort((a, b) => a.index - b.index)
    .map((instrument) => {
      const part = index.get(instrument.id),
        sample = sampleRack(part, frame.now);
      return {
        instrument,
        sample,
        tubes: instrument.settings.map((setting) => tubeAt(part, setting, sample)),
      };
    });
}
