import type { ViewFrame } from '../types';
import { clamp, pitch } from '../shared/retro-2d';

export const DENSE_AT = 128;
export const BINS = 256;
export interface Terrain {
  instrument: string;
  name: string;
  setting: string;
  min: number;
  max: number;
  samples: { start: number; end: number; value: number }[];
}
const identity = new Set([
  'note',
  'n',
  'freq',
  's',
  'sound',
  'orbit',
  'begin',
  'end',
  'unit',
  'cps',
  'cycle',
  'duration',
]);
/** Dimensionless variance times change frequency: units and instrument names cannot win.
 * Analyse exactly the supplied notes. A refreshed host window can change the driver/range;
 * retaining earlier extrema would make reverse scrubbing depend on visit order. */
export function terrainDriver(
  frame: Pick<ViewFrame, 'notes' | 'instruments'>,
): Terrain | undefined {
  let winner: Terrain | undefined;
  let best = 0;
  const fallback: Terrain[] = [];
  for (const instrument of frame.instruments.slice().sort((a, b) => a.index - b.index)) {
    if (!instrument.inSection) continue;
    const notes = frame.notes
      .filter((n) => n.instrument === instrument.id && n.end > n.start)
      .slice()
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const settings = [...new Set(notes.flatMap((n) => Object.keys(n.value)))].sort();
    for (const setting of [...settings.filter((s) => !identity.has(s)), 'pitch']) {
      const samples = notes.flatMap((n) => {
        const value = setting === 'pitch' ? pitch(n.value) : n.value[setting];
        return typeof value === 'number' && Number.isFinite(value)
          ? [{ start: n.start, end: n.end, value }]
          : [];
      });
      if (!samples.length) continue;
      let min = Infinity,
        max = -Infinity;
      for (const s of samples) {
        min = Math.min(min, s.value);
        max = Math.max(max, s.value);
      }
      const candidate = {
        instrument: instrument.id,
        name: instrument.name,
        setting,
        min,
        max,
        samples,
      };
      if (setting === 'pitch') {
        fallback.push(candidate);
        continue;
      }
      if (max === min || samples.length < 2) continue;
      const values = samples.map((s) => (s.value - min) / (max - min));
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
      const changes =
        values.slice(1).filter((v, i) => v !== values[i]).length / (values.length - 1);
      const score = variance * changes;
      if (score > best) {
        best = score;
        winner = candidate;
      }
    }
  }
  return winner ?? fallback.sort((a, b) => b.max - b.min - (a.max - a.min))[0];
}
export const peakEnvelope = (phase: number) => Math.sin(Math.PI * clamp(phase)) ** 2;
export const peakValue = (terrain: Terrain, value: number) =>
  terrain.max === terrain.min
    ? 0.55
    : 0.14 + 0.86 * clamp((value - terrain.min) / (terrain.max - terrain.min));
/** The setting is constant for the entire note. Only this fixed envelope rounds its shoulder. */
export function terrainHeight(terrain: Terrain | undefined, time: number) {
  let height = 0;
  if (terrain)
    for (const note of terrain.samples) {
      if (time < note.start || time > note.end) continue;
      height = Math.max(
        height,
        peakValue(terrain, note.value) *
          peakEnvelope((time - note.start) / (note.end - note.start)),
      );
    }
  return height;
}
export interface RidgePoint {
  x: number;
  height: number;
  count: number;
}
export function ridgeProfile(terrain: Terrain | undefined, cycle: number): RidgePoint[] {
  const samples = terrain?.samples.filter((n) => n.start < cycle + 1 && n.end > cycle) ?? [];
  if (!terrain || !samples.length)
    return [
      { x: 0, height: 0, count: 0 },
      { x: 1, height: 0, count: 0 },
    ];
  if (samples.length >= DENSE_AT) {
    const bins = Array.from({ length: BINS }, (_, i) => ({
      x: (i + 0.5) / BINS,
      height: 0,
      count: 0,
    }));
    for (const note of samples) {
      const first = Math.max(0, Math.floor((note.start - cycle) * BINS));
      const last = Math.min(BINS - 1, Math.ceil((note.end - cycle) * BINS) - 1);
      for (let i = first; i <= last; i++) {
        // Max within the occupied bin preserves even a subpixel note's peak.
        const t = clamp((note.start + note.end) / 2, cycle + i / BINS, cycle + (i + 1) / BINS);
        bins[i].height = Math.max(
          bins[i].height,
          peakValue(terrain, note.value) * peakEnvelope((t - note.start) / (note.end - note.start)),
        );
        bins[i].count++;
      }
    }
    return [
      { x: 0, height: bins[0].height, count: bins[0].count },
      ...bins,
      { x: 1, height: bins[BINS - 1].height, count: bins[BINS - 1].count },
    ];
  }
  const times = new Set([cycle, cycle + 1]);
  for (const n of samples) {
    // Spend vertices on visible width; retain a midpoint even for a subpixel peak.
    const steps = Math.min(24, Math.max(2, Math.ceil(((n.end - n.start) * BINS) / 2) * 2));
    for (let i = 0; i <= steps; i++) {
      const t = n.start + ((n.end - n.start) * i) / steps;
      if (t >= cycle && t <= cycle + 1) times.add(t);
    }
  }
  const local = { ...terrain, samples };
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => ({ x: t - cycle, height: terrainHeight(local, t), count: 1 }));
}
export function profileHeight(profile: RidgePoint[], x: number) {
  for (let i = 1; i < profile.length; i++)
    if (profile[i].x >= x) {
      const a = profile[i - 1],
        b = profile[i];
      return a.height + (b.height - a.height) * clamp((x - a.x) / Math.max(1e-9, b.x - a.x));
    }
  return profile.at(-1)?.height ?? 0;
}
export interface Spire {
  instrument: string;
  x: number;
  height: number;
  base: number;
  start: number;
  count: number;
  dense: boolean;
}
export function ridgeSpires(
  frame: Pick<ViewFrame, 'notes' | 'instruments'>,
  terrain: Terrain | undefined,
  cycle: number,
  profile: RidgePoint[],
): Spire[] {
  const result: Spire[] = [];
  for (const instrument of frame.instruments) {
    if (!instrument.inSection || instrument.id === terrain?.instrument) continue;
    const all = frame.notes.filter((n) => n.instrument === instrument.id && n.hasOnset);
    const gains = all.map((n) => (typeof n.value.gain === 'number' ? n.value.gain : 1));
    let min = Infinity,
      max = -Infinity;
    for (const gain of gains) {
      min = Math.min(min, gain);
      max = Math.max(max, gain);
    }
    const notes = all.filter((n) => n.start >= cycle && n.start < cycle + 1);
    const dense = notes.length >= DENSE_AT;
    const bins = new Map<number, Spire>();
    for (const n of notes) {
      const gain = typeof n.value.gain === 'number' ? n.value.gain : 1;
      const height = min === max ? 0.18 : 0.07 + 0.2 * clamp((gain - min) / (max - min));
      const x = dense ? (Math.floor((n.start - cycle) * BINS) + 0.5) / BINS : n.start - cycle;
      const mark = {
        instrument: instrument.id,
        x,
        height,
        base: profileHeight(profile, x),
        start: n.start,
        count: 1,
        dense,
      };
      if (!dense) result.push(mark);
      else {
        const bin = Math.floor(x * BINS);
        const old = bins.get(bin);
        if (old) {
          old.count++;
          old.height = Math.max(old.height, height);
        } else bins.set(bin, mark);
      }
    }
    result.push(...bins.values());
  }
  return result;
}
export function ridgeClock(now: number) {
  const cycle = Math.floor(now),
    phase = now - cycle;
  const t = clamp((phase - 0.72) / 0.28);
  return cycle + t * t * (3 - 2 * t);
}
export function ridgePose(cycle: number, now: number, lookAhead: number) {
  const distance = cycle - ridgeClock(now);
  const scale = Math.exp(-distance * 0.19);
  return {
    distance,
    scale,
    y: 0.82 - 1.3 * scale,
    fade:
      distance < 0
        ? Math.exp(distance * 2.4)
        : clamp((lookAhead + 1.5 - distance) / 1.5) / (1 + distance * 0.24),
  };
}
export function ridgeSection(
  sections: ViewFrame['sections'],
  cycle: number,
): { section: ViewFrame['sections'][number] | undefined; index: number; boundary: boolean } {
  const length = sections.at(-1)?.to ?? 0;
  const time = length > 0 ? ((cycle % length) + length) % length : cycle;
  const index = sections.findIndex((s) => s.from <= time && s.to > time);
  return { section: sections[index], index, boundary: sections[index]?.from === time };
}
