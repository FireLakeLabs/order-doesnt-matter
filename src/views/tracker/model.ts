import type { ViewFrame, ViewNote } from '../types';
import { clamp, indexScore, pitch, pitchName } from '../shared/retro-2d';
export const hex = (n: number) => Math.round(n).toString(16).toUpperCase().padStart(2, '0');
const effects = [
  ['lpf', 'C'],
  ['cutoff', 'C'],
  ['gain', 'V'],
  ['pan', 'P'],
  ['room', 'R'],
  ['shape', 'S'],
] as const;
export function analyse(notes: ViewNote[]) {
  const ranges = new Map<string, [number, number]>();
  for (const note of notes)
    for (const [key] of effects) {
      const v = note.value[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const r = ranges.get(key);
      ranges.set(key, r ? [Math.min(r[0], v), Math.max(r[1], v)] : [v, v]);
    }
  const rows = new Map<
    string,
    Map<number, { note: ViewNote; count: number; off: boolean; label: string; effect: string }>
  >();
  for (const note of notes) {
    if (!note.hasOnset) continue;
    let channel = rows.get(note.instrument);
    if (!channel)
      rows.set(
        note.instrument,
        (channel = new Map<
          number,
          { note: ViewNote; count: number; off: boolean; label: string; effect: string }
        >()),
      );
    const row = Math.floor(note.start * 16 + 1e-8);
    const off = Math.abs(note.start * 16 - row) > 1e-6;
    const cell = channel.get(row);
    if (cell) {
      cell.count++;
      cell.off ||= off;
      continue;
    }
    let effect = '';
    for (const [key, code] of effects) {
      const value = note.value[key],
        r = ranges.get(key);
      if (typeof value !== 'number' || !Number.isFinite(value) || !r) continue;
      // Constant ranges use their sole value as the upper bound; zero remains zero.
      const scaled = r[1] === r[0] ? (value === 0 ? 0 : 1) : (value - r[0]) / (r[1] - r[0]);
      effect = code + hex(clamp(scaled) * 255);
      break;
    }
    const p = pitch(note.value);
    channel.set(row, {
      note,
      count: 1,
      off,
      label: p === undefined ? 'HIT' : pitchName(p),
      effect,
    });
  }
  return { rows, groups: indexScore(notes) };
}
export function layout(f: Pick<ViewFrame, 'width' | 'height' | 'now' | 'instruments'>) {
  const left = Math.min(86, f.width * 0.15),
    available = Math.max(1, f.width - left - 24);
  const count = f.instruments.length;
  const effects = available / Math.max(1, count) >= 88;
  const capacity = Math.max(1, Math.floor((available - (count * 72 > available ? 34 : 0)) / 72));
  const shown = Math.min(count, capacity);
  const hidden = count - shown;
  return {
    left,
    effects,
    shown,
    hidden,
    cell: (available - (hidden ? 34 : 0)) / Math.max(1, shown),
    rowHeight: Math.max(18, Math.min(27, f.height / 27)),
    gate: f.height * 0.52,
    row: Math.floor(f.now * 16),
  };
}
export function rowY(f: Pick<ViewFrame, 'now'>, row: number, gate: number, height: number) {
  return gate + (row - f.now * 16) * height;
}

export function channels(f: Pick<ViewFrame, 'instruments'>) {
  return [...f.instruments].sort(
    (a, b) => Number(b.inSection) - Number(a.inSection) || a.index - b.index,
  );
}
