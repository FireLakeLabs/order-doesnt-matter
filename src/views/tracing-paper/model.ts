import type { ViewHistoryScore, ViewHistoryVersion, ViewNote } from '../types';
import { pitch } from '../shared/pitch';
import { settingRanges, type SettingRange } from '../shared/settings';

export type TraceRow = ViewHistoryScore['instruments'][number];
export interface TraceNote extends ViewNote {
  part: readonly [number, number];
}
export interface TracePair {
  old: TraceNote;
  fresh: TraceNote;
}
export interface SettingMark {
  instrument: string;
  name: string;
  before: string;
  after: string;
  summary?: string;
}
export interface TraceDiff {
  names: Map<string, string>;
  old: TraceNote[];
  fresh: TraceNote[];
  added: TraceNote[];
  removed: TraceNote[];
  moved: TracePair[];
  matched: TracePair[];
  resized: TracePair[];
  settings: SettingMark[];
  identical: boolean;
  opaque: boolean;
  errors: string[];
}
export function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
export function notesOf(row: TraceRow): TraceNote[] {
  return row.result.events
    .map((event) => {
      const [start, end] = event.whole ?? event.part;
      return {
        instrument: row.id,
        start,
        end,
        part: event.part,
        hasOnset: event.whole !== null && event.part[0] === start,
        value:
          event.value !== null && typeof event.value === 'object'
            ? (event.value as Record<string, unknown>)
            : { value: event.value },
      };
    })
    .sort(
      (a, b) =>
        a.start - b.start || a.end - b.end || canonical(a.value).localeCompare(canonical(b.value)),
    );
}
const voiceKey = (n: TraceNote) => {
  const p = pitch(n.value);
  // n alone can be a sample-bank index. Explicit note/frequency establishes a
  // pitched voice, whose sound can legitimately change as a setting.
  const pitched = p !== undefined && (n.value.note !== undefined || n.value.freq !== undefined);
  return canonical([
    p ?? n.value.note ?? n.value.n ?? n.value.freq,
    pitched ? undefined : n.value.s,
    n.hasOnset,
  ]);
};
function indexNotes(notes: Iterable<TraceNote>, key: (n: TraceNote) => string) {
  const result = new Map<string, TraceNote[]>();
  for (const n of notes) {
    const k = key(n),
      group = result.get(k) ?? [];
    group.push(n);
    result.set(k, group);
  }
  return result;
}
function nearest(n: TraceNote, index: Map<string, TraceNote[]>, limit: number) {
  const group = index.get(voiceKey(n));
  if (!group?.length) return;
  let lo = 0,
    hi = group.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (group[mid].start < n.start) lo = mid + 1;
    else hi = mid;
  }
  // Neighbours on either side include duplicate onsets, so multiplicity remains ambiguous.
  const candidates = group
    .slice(Math.max(0, lo - 2), lo + 2)
    .sort((a, b) => Math.abs(a.start - n.start) - Math.abs(b.start - n.start));
  const first = candidates[0],
    distance = Math.abs(first.start - n.start);
  return distance <= limit &&
    (!candidates[1] || Math.abs(Math.abs(candidates[1].start - n.start) - distance) > 1e-9)
    ? first
    : undefined;
}
const geometry = (n: TraceNote) => canonical([n.start, n.end, n.part, n.hasOnset]);
const fingerprint = (n: TraceNote) => canonical([geometry(n), n.value]);
function rangeText(range: SettingRange | undefined) {
  if (!range) return 'unset';
  const number = (n: number) => String(Math.round(n * 1000) / 1000);
  const numeric =
    range.min === undefined
      ? []
      : [
          range.min === range.max
            ? number(range.min)
            : `${number(range.min)}–${number(range.max ?? range.min)}`,
        ];
  return [...numeric, ...[...range.values].map(canonical).sort()].join(', ');
}
/** Match document instrument/pattern ids first; a unique equal document path plus use ancestry is the fallback part identity. The contract has no per-note id, so event order never supplies identity. Within that part preserve exact score matches, then unique equal-onset/equal-pitch spans, then only mutual, unique nearest onsets within 1/16 cycle with equal pitch and onset/fragment kind, with sound also equal when no explicit note/frequency establishes a pitched voice. Tied or competing candidates remain removed plus added, never a guessed move. Settings are one counted margin mark per changed part/control on matched notes, showing sampled ranges (not authored signal bounds); duration/fragment changes are separate span changes, never mislabeled as settings. Counts and equality cover the supplied query range; the contract does not expose past arrangement lengths. */
export function compareScores(before: ViewHistoryScore, after: ViewHistoryScore): TraceDiff {
  const result: TraceDiff = {
    names: new Map(),
    old: [],
    fresh: [],
    added: [],
    removed: [],
    moved: [],
    matched: [],
    resized: [],
    settings: [],
    identical: false,
    opaque: false,
    errors: [],
  };
  for (const [label, score] of [
    ['Pencil', before],
    ['Ink', after],
  ] as const)
    for (const row of score.instruments) {
      if (row.result.error) result.errors.push(`${label}: ${row.result.error.message}`);
      if (row.result.opaqueValues) result.opaque = true;
    }
  if (result.errors.length) return result;
  const remaining = new Set(after.instruments);
  for (const row of before.instruments) {
    const identity = after.instruments.filter(
      (r) => remaining.has(r) && (r.id === row.id || r.patternId === row.patternId),
    );
    const paths = after.instruments.filter(
      (r) => remaining.has(r) && canonical([r.path, r.uses]) === canonical([row.path, row.uses]),
    );
    const next =
      identity.length === 1
        ? identity[0]
        : identity.length === 0 && paths.length === 1
          ? paths[0]
          : undefined;
    const old = notesOf(row).map((n) => ({ ...n, instrument: next?.id ?? row.id }));
    result.names.set(
      next?.id ?? row.id,
      next && row.name !== next.name ? `${row.name} → ${next.name}` : row.name,
    );
    result.old.push(...old);
    if (!next) {
      result.removed.push(...old);
      continue;
    }
    remaining.delete(next);
    const fresh = notesOf(next);
    result.fresh.push(...fresh);
    const a = new Set(old),
      b = new Set(fresh),
      pairs: TracePair[] = [];
    const pair = (x: TraceNote, y: TraceNote) => {
      a.delete(x);
      b.delete(y);
      pairs.push({ old: x, fresh: y });
    };
    // Exact duplicate score marks are interchangeable, retaining their multiplicity.
    const exact = indexNotes(b, fingerprint);
    for (const x of a) {
      const y = exact.get(fingerprint(x))?.pop();
      if (y) pair(x, y);
    }
    for (const limit of [1e-9, 1 / 16 + 1e-9]) {
      const oldIndex = indexNotes(a, voiceKey),
        newIndex = indexNotes(b, voiceKey);
      for (const index of [oldIndex, newIndex])
        for (const group of index.values()) group.sort((x, y) => x.start - y.start);
      const mutual: TracePair[] = [];
      for (const x of a) {
        const y = nearest(x, newIndex, limit);
        if (y && nearest(y, oldIndex, limit) === x) mutual.push({ old: x, fresh: y });
      }
      for (const p of mutual) pair(p.old, p.fresh);
    }
    result.matched.push(...pairs);
    result.moved.push(...pairs.filter((p) => Math.abs(p.old.start - p.fresh.start) > 1e-9));
    result.removed.push(...a);
    result.added.push(...b);
    const keys = new Set(
      pairs.flatMap((p) => [...Object.keys(p.old.value), ...Object.keys(p.fresh.value)]),
    );
    const oldRanges = settingRanges(old),
      newRanges = settingRanges(fresh);
    for (const name of [...keys].sort()) {
      const changed = pairs.filter(
        (p) => canonical(p.old.value[name]) !== canonical(p.fresh.value[name]),
      ).length;
      if (!changed) continue;
      const before = rangeText(oldRanges.get(name)),
        after = rangeText(newRanges.get(name));
      result.settings.push({
        instrument: next.id,
        name,
        before,
        after,
        ...(before === after
          ? { summary: `${String(changed)} of ${String(pairs.length)} matched values changed` }
          : {}),
      });
    }
    result.resized.push(
      ...pairs.filter(
        (p) =>
          Math.abs(p.old.end - p.old.start - (p.fresh.end - p.fresh.start)) > 1e-9 ||
          p.old.part.some(
            (t, i) => Math.abs(t - p.old.start - (p.fresh.part[i] - p.fresh.start)) > 1e-9,
          ),
      ),
    );
  }
  for (const row of remaining) {
    result.names.set(row.id, row.name);
    const notes = notesOf(row);
    result.fresh.push(...notes);
    result.added.push(...notes);
  }
  result.identical =
    !result.opaque &&
    !result.added.length &&
    !result.removed.length &&
    !result.moved.length &&
    !result.settings.length &&
    !result.resized.length;
  return result;
}
export function defaultPair(versions: readonly ViewHistoryVersion[]): [string, string] | undefined {
  const present = versions.findIndex((v) => v.position === 'present');
  return present > 0 ? [versions[present - 1].id, versions[present].id] : undefined;
}
export const pencilOpacity = (age: number) =>
  Math.max(0.16, 0.56 / (1 + Math.max(0, age - 1) * 0.2));
export function barCounts(diff: TraceDiff, bar: number) {
  const at = (n: TraceNote) => n.start >= bar && n.start < bar + 1;
  const active = new Set(
    [...diff.old, ...diff.fresh]
      .filter((n) => n.end > bar && n.start < bar + 1)
      .map((n) => n.instrument),
  );
  return {
    added: diff.added.filter(at).length,
    removed: diff.removed.filter(at).length,
    moved: diff.moved.filter((p) => at(p.old) || at(p.fresh)).length,
    settings: diff.settings.filter((s) => active.has(s.instrument)).length,
  };
}
/** Stable onset bins; their counts account for every mark even at 500 notes/cycle. */
export function countBins<T>(items: readonly T[], x: (item: T) => number, cell: number) {
  const bins = new Map<number, T[]>();
  for (const item of items) {
    const key = Math.floor(x(item) / cell);
    const bin = bins.get(key) ?? [];
    bin.push(item);
    bins.set(key, bin);
  }
  return [...bins].sort(([a], [b]) => a - b).map(([slot, items]) => ({ slot, items }));
}

export interface TraceSheet {
  diff: TraceDiff;
  from: number;
  to: number;
  bars: Map<number, { counts: ReturnType<typeof barCounts>; settings: SettingMark[] }>;
}
/** Counts and margin membership are static for a queried pair/range, not frame work. */
export function indexSheet(diff: TraceDiff, from: number, to: number): TraceSheet {
  const bars: TraceSheet['bars'] = new Map();
  const notes = [...diff.old, ...diff.fresh];
  for (let bar = Math.floor(from); bar < Math.ceil(to); bar++) {
    const active = new Set(
      notes.filter((n) => n.start < bar + 1 && n.end > bar).map((n) => n.instrument),
    );
    bars.set(bar, {
      counts: barCounts(diff, bar),
      settings: diff.settings.filter((s) => active.has(s.instrument)),
    });
  }
  return { diff, from, to, bars };
}
/** Caption plates fit between both neighbouring ink rings, including at 30 px rows. */
export function markGeometry(rowHeight: number) {
  return {
    ringRadius: Math.min(9, (rowHeight - 17) / 2),
    captionTop: -22,
    captionHeight: 11,
    captionBaseline: -12,
  };
}
