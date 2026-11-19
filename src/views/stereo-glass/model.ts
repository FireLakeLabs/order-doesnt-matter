import type { ViewFrame, ViewNote } from '../types';
import { clamp } from '../shared/math';

export const DENSITY_SIZE = 160;
/** Stateless: every sample contributes once to this span's density, never to a history.
 * Positive mid goes up; positive R-L goes right. A left-only signal leans left.
 * Mono input uses left alone, without treating the absent right channel as stereo.
 */
export function measureGlass(frame: ViewFrame) {
  const a = frame.audio;
  if (
    !frame.playing ||
    !a?.complete ||
    !a.left ||
    !a.right ||
    (a.channels !== 1 && a.channels !== 2) ||
    !a.sampleRate ||
    a.left.length === 0 ||
    a.left.length !== a.right.length
  )
    return undefined;
  const bins = new Uint32Array(DENSITY_SIZE ** 2);
  let ll = 0,
    rr = 0,
    lr = 0,
    ls = 0,
    rs = 0;
  let minSide = Infinity,
    maxSide = -Infinity,
    minMid = Infinity,
    maxMid = -Infinity;
  let offGlass = 0,
    peak = 0;
  const n = a.left.length;
  for (let i = 0; i < n; i++) {
    const l = a.left[i],
      r = a.channels === 1 ? l : a.right[i];
    const mid = (l + r) / 2,
      side = (r - l) / 2;
    ll += l * l;
    rr += r * r;
    lr += l * r;
    ls += l;
    rs += r;
    minSide = Math.min(minSide, side);
    maxSide = Math.max(maxSide, side);
    minMid = Math.min(minMid, mid);
    maxMid = Math.max(maxMid, mid);
    const radius = Math.hypot(mid, side);
    if (radius > 1) offGlass++;
    const scale = Math.max(1, radius);
    const x = Math.round((((side / scale) * 0.9 + 1) / 2) * (DENSITY_SIZE - 1));
    const y = Math.round((((-mid / scale) * 0.9 + 1) / 2) * (DENSITY_SIZE - 1));
    const count = ++bins[y * DENSITY_SIZE + x];
    peak = Math.max(peak, count);
  }
  const denominator = Math.sqrt(Math.max(0, ll - (ls * ls) / n) * Math.max(0, rr - (rs * rs) / n));
  return {
    bins,
    peak,
    samples: n,
    mono: a.channels === 1,
    offGlass,
    correlation:
      a.channels === 2 && denominator > 0 ? clamp((lr - (ls * rs) / n) / denominator, -1, 1) : null,
    width: maxSide - minSide,
    height: maxMid - minMid,
    durationMs: (n / a.sampleRate) * 1000,
    lagMs: (a.lagSeconds ?? 0) * 1000,
  };
}
function panOf(value: unknown) {
  if (value === undefined) return { pan: 0.5, source: 'default' as const };
  const pan = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof pan === 'number' && Number.isFinite(pan)
    ? { pan: clamp(pan), source: 'written' as const }
    : { pan: 0.5, source: 'unknown' as const };
}
export function panAngle(pan: number) {
  return ((pan - 0.5) * Math.PI) / 2;
}
/** One tick per part and sampled pan in the score window; coincident notes counted.
 * The radial lane is document order, independent of siblings entering/leaving.
 * Beyond 24 lanes, the outer lane merges ticks; totals remain in the legend.
 */
export function scoredRim(frame: ViewFrame) {
  const groups = new Map<string, ViewNote[]>();
  for (const note of frame.notes) {
    if (note.end <= frame.from || note.start >= frame.to) continue;
    const notes = groups.get(note.instrument) ?? [];
    notes.push(note);
    groups.set(note.instrument, notes);
  }
  return frame.instruments
    .slice()
    .sort((a, b) => a.index - b.index)
    .flatMap((instrument) => {
      const notes = groups.get(instrument.id) ?? [];
      const ticks = new Map<
        string,
        {
          instrument: typeof instrument;
          pan: number;
          source: 'default' | 'written' | 'unknown';
          lane: number;
          count: number;
          onsets: number;
          held: number;
        }
      >();
      const add = (value: unknown, note?: ViewNote) => {
        const p = panOf(value),
          key = `${String(p.pan)}:${p.source}`;
        let tick = ticks.get(key);
        if (!tick) {
          tick = {
            instrument,
            ...p,
            lane: Math.min(23, instrument.index),
            count: 0,
            onsets: 0,
            held: 0,
          };
          ticks.set(key, tick);
        }
        if (note) {
          tick.count++;
          if (note.start <= frame.now && frame.now < note.end) tick.held++;
          // A score-cycle flash: stepping/tempo changes preserve the same score picture.
          if (note.hasOnset && frame.now >= note.start && frame.now - note.start < 0.08)
            tick.onsets++;
        }
      };
      for (const note of notes) add(note.value.pan, note);
      if (!notes.length) {
        const setting = instrument.settings.find((s) => s.name === 'pan');
        add(setting?.kind === 'constant' ? setting.value : setting ? null : undefined);
      }
      return [...ticks.values()].sort((a, b) => a.pan - b.pan || a.source.localeCompare(b.source));
    });
}
export function glassLayout(width: number, height: number, lanes = 24) {
  const wide = width >= 850;
  const legendWidth = wide ? Math.min(300, width * 0.27) : 0;
  const leftWidth = width - legendWidth;
  const top = wide ? 80 : 134;
  const bottom = height - (wide ? 72 : 154);
  const stack = 20 + Math.min(23, Math.max(0, lanes - 1)) * 3;
  const radius = Math.max(10, Math.min((leftWidth - 110) / 2, (bottom - top - stack) / 2));
  return {
    wide,
    stack,
    cx: leftWidth / 2,
    cy: top + stack + radius,
    radius,
    legendX: leftWidth + 8,
    legendWidth,
    bottom,
  };
}

/** Merge only coincident part/pan lanes. Every source tick and span stays counted. */
export function rimMarks(ticks: ReturnType<typeof scoredRim>, radius: number) {
  const marks = new Map<
    string,
    {
      angle: number;
      radius: number;
      colour: string;
      ticks: number;
      spans: number;
      held: number;
      onsets: number;
    }
  >();
  for (const tick of ticks) {
    const key = `${String(tick.pan)}:${String(tick.lane)}`;
    const mark = marks.get(key);
    if (mark) {
      mark.ticks++;
      mark.spans += tick.count;
      mark.held += tick.held;
      mark.onsets += tick.onsets;
    } else
      marks.set(key, {
        angle: panAngle(tick.pan),
        radius: radius + 17 + tick.lane * 3,
        colour: tick.instrument.colour,
        ticks: 1,
        spans: tick.count,
        held: tick.held,
        onsets: tick.onsets,
      });
  }
  return [...marks.values()];
}
