import type { ViewFrame, ViewNote } from '../types';
import { roleEvidence } from '../shared/roles';
import { pitch } from '../shared/pitch';

export interface Phrase {
  id: number;
  instrument: string;
  from: number;
  to: number;
  notes: ViewNote[];
  pitches: number[];
  rhythm: string | null;
  shape: string | null;
  known: boolean;
}
export interface Return {
  before: number;
  after: number;
  kind: 'exact' | 'near';
  distance: number;
  transpose: number;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** Recover fractions with denominator ≤4096 within 1e−10 cycle; unsafe times stay unknown. */
export function rational(value: number): [number, number] | null {
  if (!Number.isFinite(value)) return null;
  for (let d = 1; d <= 4096; d++) {
    const n = Math.round(value * d);
    if (Number.isSafeInteger(n) && Math.abs(n / d - value) < 1e-10) {
      const g = gcd(Math.abs(n), d);
      return [n / g, d / g];
    }
  }
  return null;
}
function rhythmKey(times: number[]): string | null {
  const fractions = times.map(rational);
  let scale = 1;
  for (const f of fractions) {
    if (!f) return null;
    scale = (scale / gcd(scale, f[1])) * f[1];
    if (!Number.isSafeInteger(scale)) return null;
  }
  const ticks = fractions.map((f) => (f ? f[0] * (scale / f[1]) : NaN));
  if (ticks.some((n) => !Number.isSafeInteger(n))) return null;
  const origin = ticks[0];
  const relative = ticks.map((n) => n - origin);
  if (relative.some((n) => !Number.isSafeInteger(n))) return null;
  const divisor = relative.reduce((g, n) => gcd(g, Math.abs(n)), scale);
  return JSON.stringify([scale / divisor, ...relative.map((n) => n / divisor)]);
}
export function relayRange(frame: ViewFrame): [number, number] {
  const length = frame.sections.at(-1)?.to ?? 16;
  const from = Math.max(0, Math.floor(frame.now / length)) * length;
  return [from, from + length];
}
/** Phrases are nonoverlapping four-cycle blocks anchored at each section start
 * (at the 16-cycle display start without sections), shortened at section ends.
 * Only fully queried blocks of 3–16 pitched, onset-bearing, nonoverlapping notes
 * qualify; unpaired continuations, chords, opaque pitches/times and crossing notes
 * stay counted and unmatched. A bare n can be a sample index, so only note or
 * frequency establishes pitch. Coincident control fragments backed by an identical
 * onset contribute to record counts, not extra attacks. Rhythm compares recovered
 * rational offsets from the first onset AND durations exactly (denominator <=4096, tolerance <1e-10,
 * safe integer arithmetic); pitch shape is the vector of semitone offsets from
 * the first pitch. Exact returns require identical rhythm and shape, allowing
 * a labelled constant transposition. Near returns require identical rhythm/count,
 * mean absolute shape deviation >0 and <=0.5 semitone, and no deviation >2;
 * the mean is the labelled distance. No rounded bar signatures, settings, names, source
 * period guess, octave folding or transitive near-match closure decides equality.
 * The containing phrase block stays current through its rests.
 */
export function indexRelay(frame: ViewFrame) {
  const [from, to] = relayRange(frame);
  const sections = frame.sections.length
    ? frame.sections.map((s) => ({ ...s, from: s.from + from, to: s.to + from }))
    : [{ name: 'Observed score', from, to }];
  const parts = roleEvidence(frame.notes);
  const phrases: Phrase[] = [];
  for (const instrument of [...frame.instruments].sort(
    (a, b) => a.index - b.index || a.id.localeCompare(b.id),
  )) {
    const events = (parts.get(instrument.id)?.events ?? []).map((e) => ({
      ...e,
      // The shared reader retains legacy n semantics. Relay cannot establish a
      // pitch shape from an ambiguous sample index; explicit frequency is safe.
      pitch:
        e.note.value.note === undefined && e.note.value.n !== undefined
          ? pitch({ freq: e.note.value.freq })
          : e.pitch,
    }));
    for (const section of sections)
      for (let a = section.from; a < section.to; a += 4) {
        const b = Math.min(a + 4, section.to);
        const entries = events.filter((e) => e.note.start < b && e.note.end > a);
        if (!entries.length) continue;
        const notes = entries.map((e) => e.note);
        const hits = entries.filter((e) => e.note.hasOnset);
        const known = frame.from <= a && frame.to >= b;
        const valid =
          known &&
          hits.length >= 3 &&
          hits.length <= 16 &&
          entries.every(
            (e) =>
              e.pitch !== undefined &&
              e.note.start >= a &&
              e.note.end <= b &&
              e.note.end > e.note.start &&
              (e.note.hasOnset ||
                hits.some(
                  (h) =>
                    h.note.start === e.note.start &&
                    h.note.end === e.note.end &&
                    h.pitch === e.pitch,
                )),
          ) &&
          hits.every((e, i) => !i || hits[i - 1].note.end <= e.note.start);
        const pitches = valid ? hits.flatMap((e) => (e.pitch === undefined ? [] : [e.pitch])) : [];
        const rhythm = valid ? rhythmKey(hits.flatMap((e) => [e.note.start, e.note.end])) : null;
        const offsets = pitches.map((p) => p - pitches[0]);
        const shape = rhythm && offsets.every(Number.isFinite) ? JSON.stringify(offsets) : null;
        phrases.push({
          id: phrases.length,
          instrument: instrument.id,
          from: a,
          to: b,
          notes,
          pitches,
          rhythm,
          shape,
          known,
        });
      }
  }
  const returns: Return[] = [];
  const buckets = new Map<string, Phrase[]>();
  for (const phrase of [...phrases].sort((a, b) => a.from - b.from || a.id - b.id)) {
    if (!phrase.rhythm || !phrase.shape) continue;
    const prior = buckets.get(phrase.rhythm) ?? [];
    for (const before of prior) {
      const deviations = phrase.pitches.map((p, i) =>
        Math.abs(p - phrase.pitches[0] - (before.pitches[i] - before.pitches[0])),
      );
      const distance = deviations.reduce((s, n) => s + n, 0) / deviations.length;
      if (
        phrase.shape === before.shape ||
        (distance > 0 && distance <= 0.5 && Math.max(...deviations) <= 2)
      )
        returns.push({
          before: before.id,
          after: phrase.id,
          kind: phrase.shape === before.shape ? 'exact' : 'near',
          distance,
          transpose: phrase.pitches[0] - before.pitches[0],
        });
    }
    prior.push(phrase);
    buckets.set(phrase.rhythm, prior);
  }
  return { from, to, sections, phrases, returns };
}
export type Relay = ReturnType<typeof indexRelay>;
export function relayFocus(score: Relay, now: number) {
  const current = new Set(
    score.phrases.filter((p) => p.from <= now && now < p.to).map((p) => p.id),
  );
  const links = score.returns.filter((r) => current.has(r.before) || current.has(r.after));
  return { current, related: new Set(links.flatMap((r) => [r.before, r.after])), links };
}
/** Phrase-local bins retain every owned record without spilling into neighbouring batons. */
export function capsules(phrases: Phrase[], from: number, to: number, width: number) {
  return phrases.flatMap((p) => {
    const a = Math.max(from, p.from),
      b = Math.min(to, p.to);
    if (b <= a) return [];
    const bins = Math.max(1, Math.floor((width * (b - a)) / (to - from) / 38));
    const buckets = new Map<number, ViewNote[]>();
    for (const n of p.notes) {
      // A crossing note belongs to its first visible block only.
      if (p.from > Math.max(from, n.start) || n.end <= a || n.start >= b) continue;
      const slot = Math.min(
        bins - 1,
        Math.max(0, Math.floor(((Math.max(a, n.start) - a) / (b - a)) * bins)),
      );
      const bucket = buckets.get(slot) ?? [];
      bucket.push(n);
      buckets.set(slot, bucket);
    }
    return [...buckets].map(([slot, notes]) => ({
      from: a + (slot / bins) * (b - a),
      to: Math.min(b, a + ((slot + 1) / bins) * (b - a)),
      notes,
      count: notes.length,
      attacks: notes.filter((n) => n.hasOnset).length,
    }));
  });
}
export function relayLayout(width: number, height: number, lanes: number) {
  const left = width < 700 ? 100 : 150;
  const right = width - 38;
  const top = 112;
  const bottom = height - 128;
  return { left, right, top, bottom, lane: (bottom - top) / Math.max(1, lanes) };
}
export function shapeHue(shape: string): number {
  let hash = 2166136261;
  for (const c of shape) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0) % 360;
}
/** Two decimal places for labels; tiny nonzero differences retain a compact nonzero value. */
export function displayNumber(n: number): string {
  return n !== 0 && Math.abs(n) < 0.01
    ? n.toExponential(1).replace('.0e', 'e')
    : String(Number(n.toFixed(2)));
}
export const transposeText = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${displayNumber(Math.abs(n))}`;
