import type { ViewNote } from '../types';

export interface BarSummary {
  bar: number;
  instruments: ReadonlySet<string>;
  change: number;
}
// Floating point conversion of Strudel fractions can differ across adjacent bars.
const relative = (time: number) => Math.round(time * 1e9) / 1e9;
function canonical(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || typeof value !== 'object') return `${typeof value}:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}
/** Per integer cycle, compare clipped, bar-relative (1e−9 cycle precision) note multisets (instrument, spans, onset, settings) by 1−intersection/union; empty/empty is 0, and from also reads its preceding bar. */
export function songSummary(notes: readonly ViewNote[], from: number, to: number): BarSummary[] {
  const result: BarSummary[] = [];
  if (to <= from) return result;
  let previous = new Map<string, number>();
  for (let bar = Math.floor(from) - 1; bar < Math.ceil(to); bar++) {
    const instruments = new Set<string>();
    const current = new Map<string, number>();
    for (const note of notes) {
      if (note.end <= bar || note.start >= bar + 1) continue;
      instruments.add(note.instrument);
      const key = canonical([
        note.instrument,
        relative(Math.max(bar, note.start) - bar),
        relative(Math.min(bar + 1, note.end) - bar),
        note.hasOnset && note.start >= bar,
        note.value,
      ]);
      current.set(key, (current.get(key) ?? 0) + 1);
    }
    let intersection = 0,
      union = 0;
    for (const [key, count] of current) {
      intersection += Math.min(count, previous.get(key) ?? 0);
      union += Math.max(count, previous.get(key) ?? 0);
    }
    for (const [key, count] of previous) if (!current.has(key)) union += count;
    if (bar >= Math.floor(from))
      result.push({
        bar,
        instruments,
        change: union ? 1 - intersection / union : 0,
      });
    previous = current;
  }
  return result;
}
