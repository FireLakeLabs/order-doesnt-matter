import type { ViewFrame, ViewNote } from '../types';
import { pitch } from '../shared/pitch';

export interface Rational {
  n: number;
  d: number;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const mod = (a: number, b: number) => ((a % b) + b) % b;
/** Recover small score fractions from the contract's doubles; refuse ambiguous/high-denominator times. */
export function rational(value: number): Rational | null {
  if (!Number.isFinite(value)) return null;
  for (let d = 1; d <= 4096; d++) {
    const n = Math.round(value * d);
    if (Number.isSafeInteger(n) && Math.abs(n / d - value) < 1e-10) {
      const g = gcd(Math.abs(n), d);
      return { n: n / g, d: d / g };
    }
  }
  return null;
}
export function commonPeriod(periods: Rational[]): Rational | null {
  let n = 1;
  for (const p of periods) {
    n = (n / gcd(n, p.n)) * p.n;
    if (!Number.isSafeInteger(n)) return null;
  }
  // LCM(a/b,c/d) = LCM(a,c)/GCD(b,d), for reduced positive fractions.
  if (!periods.length) return null;
  const d = periods.reduce((a, p) => gcd(a, p.d), periods[0].d);
  return { n, d };
}
export const periodText = (p: Rational | null) =>
  p ? (p.d === 1 ? String(p.n) : `${String(p.n)}/${String(p.d)}`) : 'unknown';
export interface Orbit {
  id: string;
  period: Rational | null;
  reason: string;
  observed: number;
  marks: { phase: number; count: number }[];
}
interface Event {
  start: number;
  duration: number;
  key: string;
}
function identity(note: ViewNote): string | null {
  const v = note.value;
  const identity = [
    pitch(v) ?? v.note ?? v.freq ?? null,
    v.n ?? null,
    v.s ?? v.sound ?? v.value ?? null,
    v.bank ?? null,
  ];
  if (
    identity.some(
      (x) =>
        (x !== null && !['string', 'number', 'boolean'].includes(typeof x)) ||
        (typeof x === 'number' && !Number.isFinite(x)),
    )
  )
    return null;
  return JSON.stringify(identity);
}
/** Compare onset/pitch/sample/duration multisets, excluding settings and section gates.
 * An observed period is never a claim about the unqueried future or source structure.
 * Every predicted onset inside each occupied section must exist, with multiplicity,
 * and each motif must have at least two distinct observed occurrences.
 */
function infer(notes: ViewNote[], frame: ViewFrame): Omit<Orbit, 'id'> {
  const observed = notes.filter(
    (n) => n.hasOnset && n.start >= frame.from && n.start < frame.to,
  ).length;
  const unknown = (reason: string): Omit<Orbit, 'id'> => ({
    period: null,
    reason,
    observed,
    marks: [],
  });
  if (!observed) return unknown('no onsets observed');
  // Control patterns can split one whole note into several fragments. A fragment
  // is accounted for by its matching onset, never counted as another attack.
  const onsets = notes.filter((n) => n.hasOnset);
  if (
    notes.some(
      (n) =>
        !n.hasOnset &&
        !onsets.some((o) => o.start === n.start && o.end === n.end && identity(o) === identity(n)),
    )
  )
    return unknown('fragment without an observed onset');
  notes = onsets;
  const ranges = frame.sections.length
    ? frame.sections
        .map((s) => {
          const length = frame.sections.at(-1)?.to ?? frame.to;
          const offset = Math.floor(frame.from / length) * length;
          return {
            from: Math.max(frame.from, s.from + offset),
            to: Math.min(frame.to, s.to + offset),
          };
        })
        .filter((s) => s.to > s.from && notes.some((n) => n.start >= s.from && n.start < s.to))
    : [{ from: frame.from, to: frame.to }];
  if (
    notes.some((n) => !ranges.some((r) => n.start >= r.from && n.start < r.to)) ||
    ranges.some((r, i) => ranges.some((s, j) => i < j && r.from < s.to && s.from < r.to))
  )
    return unknown('ambiguous section coverage');
  const fractions = [
    ...ranges.flatMap((s) => [rational(s.from), rational(s.to)]),
    ...notes.flatMap((n) => [rational(n.start), rational(n.end)]),
  ];
  let scale = 1;
  for (const f of fractions) {
    if (!f) return unknown('timing is not a recoverable rational');
    scale = (scale / gcd(scale, f.d)) * f.d;
    if (!Number.isSafeInteger(scale) || Math.abs(scale * frame.to) > Number.MAX_SAFE_INTEGER)
      return unknown('rational range too large');
  }
  if (fractions.some((f) => f !== null && !Number.isSafeInteger(f.n * (scale / f.d))))
    return unknown('rational range too large');
  const intervals = ranges.map((r) => ({
    from: Math.round(r.from * scale),
    to: Math.round(r.to * scale),
  }));
  const events: Event[] = [];
  for (const note of notes) {
    const key = identity(note);
    if (key === null) return unknown('opaque note identity');
    if (note.start < frame.from || note.start >= frame.to)
      return unknown('incomplete onset coverage');
    events.push({
      start: Math.round(note.start * scale),
      duration: Math.round((note.end - note.start) * scale),
      key,
    });
  }
  events.sort((a, b) => a.start - b.start || a.key.localeCompare(b.key) || a.duration - b.duration);
  const candidates = new Set<number>();
  const first = new Map<string, number>();
  const gaps = new Set<number>();
  for (const e of events) {
    if (e.duration > 0) candidates.add(e.duration);
    const key = `${String(e.duration)}:${e.key}`;
    const prior = first.get(key);
    if (prior !== undefined && e.start > prior) gaps.add(e.start - prior);
    else first.set(key, e.start);
  }
  const exposure = intervals.reduce((sum, r) => sum + r.to - r.from, 0);
  // Gates may hide intermediate copies. Every valid period on the recovered
  // timing grid divides a gap from the first occurrence of its motif key.
  let work = 0;
  for (const gap of gaps) {
    for (let divisor = 1; divisor <= gap / divisor; divisor++) {
      if (++work > 65536) return unknown('repeat search exceeds timing budget');
      if (gap % divisor) continue;
      candidates.add(divisor);
      candidates.add(gap / divisor);
    }
  }
  const actual = new Map<string, number>();
  for (const e of events) {
    const key = `${String(e.start)}:${String(e.duration)}:${e.key}`;
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }
  for (const period of [...candidates]
    .filter((p) => p * 2 <= exposure)
    .sort((a, b) => a - b)
    .slice(0, 512)) {
    const motifs = new Map<
      string,
      { phase: number; duration: number; key: string; count: number }
    >();
    for (const e of events) {
      const phase = mod(e.start, period),
        key = `${String(phase)}:${String(e.duration)}:${e.key}`;
      if (!motifs.has(key))
        motifs.set(key, {
          ...e,
          phase,
          count: actual.get(`${String(e.start)}:${String(e.duration)}:${e.key}`) ?? 0,
        });
    }
    let valid = true;
    for (const m of motifs.values()) {
      let copies = 0;
      for (const range of intervals) {
        for (
          let t = m.phase + Math.ceil((range.from - m.phase) / period) * period;
          t < range.to;
          t += period
        ) {
          if (actual.get(`${String(t)}:${String(m.duration)}:${m.key}`) !== m.count) {
            valid = false;
            break;
          }
          copies++;
        }
        if (!valid) break;
      }
      if (!valid || copies < 2) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    const marks = new Map<number, number>();
    for (const m of motifs.values())
      marks.set(m.phase / period, (marks.get(m.phase / period) ?? 0) + m.count);
    const g = gcd(period, scale);
    return {
      period: { n: period / g, d: scale / g },
      reason: 'observed note period',
      observed,
      marks: [...marks].sort((a, b) => a[0] - b[0]).map(([phase, count]) => ({ phase, count })),
    };
  }
  return unknown('no repeated note pattern established');
}
export function indexOrrery(frame: ViewFrame) {
  const buckets = new Map<string, ViewNote[]>();
  for (const n of frame.notes) {
    const bucket = buckets.get(n.instrument) ?? [];
    bucket.push(n);
    buckets.set(n.instrument, bucket);
  }
  const orbits = [...frame.instruments]
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))
    .map((i) => ({ id: i.id, ...infer(buckets.get(i.id) ?? [], frame) }));
  const known = orbits.flatMap((o) => (o.period ? [o.period] : []));
  return {
    orbits,
    common: commonPeriod(known),
    complete: known.length === orbits.length && orbits.length > 0,
  };
}
export type Orrery = ReturnType<typeof indexOrrery>;
export function orbitPhase(period: Rational, now: number) {
  return mod((now * period.d) / period.n, 1);
}
export function alignment(period: Rational | null, now: number) {
  if (!period) return null;
  const p = period.n / period.d;
  const previous = Math.floor((now + 1e-10) / p) * p;
  return { next: previous + p, flash: Math.max(0, 1 - (now - previous) / Math.min(0.2, p * 0.15)) };
}
/** Crowds keep their exact motif-note counts in fixed angular bins. */
export function orbitMarks(orbit: Orbit, radius: number) {
  const bins = Math.max(1, Math.floor((2 * Math.PI * radius) / 14));
  const marks = new Map<number, { phase: number; count: number }>();
  for (const m of orbit.marks) {
    const bin = Math.floor(m.phase * bins);
    const mark = marks.get(bin);
    if (mark) mark.count += m.count;
    else marks.set(bin, { ...m });
  }
  return [...marks.values()];
}
export function orreryLayout(width: number, height: number, count: number) {
  const narrow = width < 760;
  const ledgerWidth = narrow ? width - 32 : Math.min(268, width * 0.29);
  const skyWidth = narrow ? width : width - ledgerWidth - 28;
  const skyHeight = narrow ? Math.min(height * 0.4, width * 0.72) : height - 160;
  const radius = Math.max(12, Math.min(skyWidth / 2 - 24, skyHeight / 2 - 26));
  const cx = skyWidth / 2,
    cy = 76 + skyHeight / 2;
  const ledger = {
    x: narrow ? 16 : skyWidth + 12,
    y: narrow ? 90 + skyHeight : 82,
    width: ledgerWidth,
  };
  const rows = Math.max(0, Math.floor((height - 96 - ledger.y) / 26));
  const shown = Math.min(count, count > rows ? Math.max(0, rows - 1) : rows);
  return {
    cx,
    cy,
    radius,
    rx: Math.max(20, skyWidth / 2 - 32),
    ledger,
    shown,
    hidden: count - shown,
    sun: Math.max(narrow ? 24 : 32, Math.min(44, radius * 0.19)),
    narrow,
  };
}
