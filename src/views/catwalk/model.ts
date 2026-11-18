import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { clamp } from '../shared/math';
import { mostRegularDrum, roleEvidence } from '../shared/roles';
import { noteName, pitch } from '../shared/pitch';

export type Garment = 'hat' | 'cape' | 'spikes' | 'antenna' | 'boots' | 'size' | 'side' | 'badge';
export interface OutfitItem {
  name: string;
  value: unknown;
  garment: Garment;
  size: number;
}
const garments: Record<string, Garment> = {
  lpf: 'hat',
  cutoff: 'hat',
  room: 'cape',
  shape: 'spikes',
  resonance: 'antenna',
  lpq: 'antenna',
  hpf: 'boots',
  hcutoff: 'boots',
  gain: 'size',
  pan: 'side',
};
const numeric = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Absolute scales keep a held outfit unchanged when the host replaces its window. */
export function outfit(note: ViewNote): OutfitItem[] {
  return Object.keys(note.value)
    .sort()
    .map((name) => {
      const value = note.value[name];
      const garment = Object.hasOwn(garments, name) ? garments[name] : 'badge';
      const n = numeric(value, 0);
      const size =
        garment === 'hat' || garment === 'boots'
          ? clamp(Math.log2(1 + Math.max(0, n)) / Math.log2(20001))
          : garment === 'antenna'
            ? clamp(n / 30)
            : garment === 'size'
              ? clamp(n / 2)
              : garment === 'badge'
                ? (2 / Math.PI) * Math.atan(Math.abs(n))
                : clamp(n);
      return { name, value, garment, size };
    });
}
export function valueText(value: unknown): string {
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(Number(value.toFixed(3))) : String(value);
  if (typeof value === 'string') return value;
  return value === undefined ? 'undefined' : JSON.stringify(value);
}
export function noteTitle(note: ViewNote): string {
  const p = pitch(note.value);
  return p === undefined ? '' : noteName(p);
}
export interface Gait {
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
  hips: number;
  shoulders: number;
  arm: number;
}
export interface Figure {
  note: ViewNote | undefined;
  instrument: ViewInstrument;
  members: ViewNote[];
  outfit: OutfitItem[];
  walking: boolean;
  next: boolean;
  posing: boolean;
  returning: boolean;
  progress: number;
  pose: number;
  flourish: number;
  x: number;
  y: number;
  scale: number;
  facing: number;
  gait: Gait;
}
export function runway(frame: Pick<ViewFrame, 'width' | 'height'>) {
  return {
    back: frame.height * 0.34,
    front: frame.height * 0.87,
    backWidth: frame.width * 0.12,
    frontWidth: frame.width * 0.56,
  };
}

/** viewNotes retains query fragments. Identical continuations of an onset are
 * one held outfit, while coincident onsets remain genuine polyphony. */
export function scoredNotes(notes: ViewNote[]): ViewNote[] {
  const key = (n: ViewNote) =>
    JSON.stringify([
      n.instrument,
      n.start,
      n.end,
      Object.keys(n.value)
        .sort()
        .map((k) => [k, n.value[k]]),
    ]);
  const onsets = new Set(notes.filter((n) => n.hasOnset).map(key));
  return notes.filter((n) => {
    if (n.hasOnset) return true;
    const id = key(n);
    return !onsets.has(id);
  });
}

export function analyse(notes: ViewNote[]) {
  const clean = scoredNotes(notes);
  const parts = new Map<string, ViewNote[]>();
  for (const n of clean) {
    const part = parts.get(n.instrument) ?? [];
    part.push(n);
    parts.set(n.instrument, part);
  }
  for (const part of parts.values())
    part.sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)),
    );
  const bars = new Map<number, ViewNote[]>();
  for (const n of clean) {
    if (!n.hasOnset) continue;
    const bar = Math.floor(n.start);
    const hits = bars.get(bar) ?? [];
    hits.push(n);
    bars.set(bar, hits);
  }
  // Judge steadiness within each bar: arrangement gaps are not uneven steps.
  const steps = new Map(
    [...bars].map(([bar, hits]) => {
      const drum = mostRegularDrum(roleEvidence(hits));
      return [
        bar,
        [...new Set((parts.get(drum ?? '') ?? []).filter((n) => n.hasOnset).map((n) => n.start))],
      ] as const;
    }),
  );
  return { parts, steps };
}
export type ShowScore = ReturnType<typeof analyse>;
const mod = (n: number, d: number) => ((n % d) + d) % d;
const ease = (t: number) => t * t * (3 - 2 * t);

/** A complete cross-step cycle: contact, passing and lifted foot, on both sides.
 * Smooth interpolation preserves contact at the scored step and avoids sine jitter. */
const poses: Gait[] = [
  { leftX: 3, leftY: 0, rightX: 8, rightY: -9, hips: -4, shoulders: 4, arm: -8 },
  { leftX: 1, leftY: 0, rightX: 1, rightY: -6, hips: -2, shoulders: 2, arm: -4 },
  { leftX: -3, leftY: -5, rightX: -2, rightY: -2, hips: 2, shoulders: -2, arm: 4 },
  { leftX: -8, leftY: -9, rightX: -3, rightY: 0, hips: 4, shoulders: -4, arm: 8 },
  { leftX: -1, leftY: -6, rightX: -1, rightY: 0, hips: 2, shoulders: -2, arm: 4 },
  { leftX: 2, leftY: -2, rightX: 3, rightY: -5, hips: -2, shoulders: 2, arm: -4 },
];
export function gaitAt(step: number): Gait {
  const phase = mod(step, 2) * 3;
  const i = Math.floor(phase);
  const t = ease(phase - i);
  const a = poses[i],
    b = poses[(i + 1) % poses.length];
  return Object.fromEntries(
    Object.keys(a).map((key) => {
      const k = key as keyof Gait;
      return [k, a[k] + (b[k] - a[k]) * t];
    }),
  ) as unknown as Gait;
}
const still: Gait = { leftX: -8, leftY: 0, rightX: 8, rightY: 0, hips: 0, shoulders: 0, arm: 0 };

/** Integer phases are foot contacts. Only scored drum onsets set their timing.
 * The query edges are extended by the nearest gap, never by a private clock. */
export function stepAt(score: ShowScore, now: number): number {
  const hits = score.steps.get(Math.floor(now)) ?? [];
  if (!hits.length) return now * 4;
  if (hits.length === 1) return (now - hits[0]) * 4;
  const next = hits.findIndex((t) => t > now);
  if (next === 0) return (now - hits[0]) / (hits[1] - hits[0]);
  if (next < 0)
    return (
      hits.length -
      1 +
      (now - hits[hits.length - 1]) / (hits[hits.length - 1] - hits[hits.length - 2])
    );
  return next - 1 + (now - hits[next - 1]) / (hits[next] - hits[next - 1]);
}

export function turn(frame: ViewFrame, score: ShowScore, bar = Math.floor(frame.now)) {
  const eligible = [...frame.instruments]
    .sort((a, b) => a.index - b.index)
    .filter((i) => score.parts.get(i.id)?.some((n) => n.start < bar + 1 && n.end > bar));
  return eligible[mod(bar, eligible.length)]?.id;
}

/** One persistent model per scored part, including parts waiting through a rest. */
export function figures(frame: ViewFrame, score = analyse(frame.notes)): Figure[] {
  const bar = Math.floor(frame.now),
    phase = frame.now - bar;
  const walking = turn(frame, score);
  const next = turn(frame, score, bar + 1);
  const previous = turn(frame, score, bar - 1);
  const cast = [...frame.instruments].sort((a, b) => a.index - b.index);
  const r = runway(frame);
  const walkingGait = gaitAt(stepAt(score, frame.now));
  return cast
    .map((instrument, index) => {
      const notes = score.parts.get(instrument.id) ?? [];
      const latest = notes.findLast((n) => n.start <= frame.now);
      const note = latest ?? notes.at(0);
      const members = notes.filter((n) => n.start < bar + 1 && n.end > bar);
      const onsets = notes.filter((n) => n.hasOnset && n.start >= bar && n.start <= frame.now);
      const active = instrument.id === walking;
      const posing = active && phase >= 0.35 && phase < 0.65;
      const returning = active && phase >= 0.65;
      const progress = !active
        ? 0
        : phase < 0.35
          ? ease(phase / 0.35)
          : phase < 0.65
            ? 1
            : 1 - ease((phase - 0.65) / 0.35);
      const pan = clamp(numeric(note?.value.pan, 0.5));
      const breadth = r.backWidth + (r.frontWidth - r.backWidth) * progress;
      // Waiting cast line the curtain wings; the next turn has a marked entrance slot.
      const side = index % 2 ? 1 : -1;
      const rank = Math.floor(index / 2);
      const wingCount = Math.ceil(cast.length / 2);
      const queueX =
        frame.width / 2 + side * frame.width * (0.115 + (rank * 0.31) / Math.max(1, wingCount));
      const isNext = instrument.id === next && !active;
      const entrance = frame.width / 2 + r.backWidth * 0.65;
      const exit = frame.width / 2 - r.backWidth * 0.65;
      const waitingFrom = instrument.id === previous ? exit : queueX;
      const waitingTo = isNext ? entrance : queueX;
      const waitingX = waitingFrom + (waitingTo - waitingFrom) * ease(clamp(phase / 0.3));
      const gain = clamp(numeric(note?.value.gain, 1), 0, 4);
      const body = Math.min(frame.height / 540, frame.width / 900);
      const latestOnset = notes.findLast((n) => n.hasOnset && n.start <= frame.now);
      const flourish = latestOnset
        ? clamp(1 - (frame.now - latestOnset.start) / (Math.max(frame.cps, 0.001) * 0.15))
        : 0;
      const settle = active
        ? Math.min(
            ease(clamp(phase / 0.04)),
            ease(clamp((1 - phase) / 0.04)),
            phase < 0.35
              ? ease(clamp((0.35 - phase) / 0.025))
              : ease(clamp((phase - 0.65) / 0.025)),
          )
        : 0;
      const gait =
        active && !posing
          ? (Object.fromEntries(
              Object.keys(still).map((key) => {
                const k = key as keyof Gait;
                return [k, still[k] + (walkingGait[k] - still[k]) * settle];
              }),
            ) as unknown as Gait)
          : still;
      return {
        note,
        instrument,
        members,
        outfit: note ? outfit(note) : [],
        walking: active,
        next: isNext,
        posing,
        returning,
        progress,
        pose: onsets.length % 3,
        flourish,
        x: active
          ? frame.width / 2 +
            (pan - 0.5) * breadth * 0.62 * progress +
            ((returning && next !== walking ? exit : entrance) - frame.width / 2) * (1 - progress)
          : waitingX,
        y: r.back + (active ? (r.front - r.back) * progress : 0),
        scale: body * (0.38 + (active ? progress * 1.02 : 0)) * (0.7 + Math.sqrt(gain) * 0.3),
        facing: returning ? 1 - 2 * ease(clamp((phase - 0.65) / 0.07)) : 1,
        gait,
      };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export interface CameraFlash {
  slot: number;
  instrument: string;
  count: number;
  brightness: number;
}
/** Every onset fires. Coincident/dense flashes share a counted photographer badge. */
export function cameraFlashes(frame: ViewFrame, score: ShowScore): CameraFlash[] {
  const flashes = new Map<string, CameraFlash>();
  const age = Math.max(frame.cps, 0.001) * 0.15;
  for (const [id, notes] of score.parts) {
    const index = frame.instruments.find((i) => i.id === id)?.index ?? 0;
    notes.forEach((n, i) => {
      if (!n.hasOnset || n.start > frame.now || frame.now - n.start >= age) return;
      const slot = mod(index * 3 + i, 20);
      const key = `${id}:${String(slot)}`;
      const brightness =
        (clamp(numeric(n.value.gain, 1), 0, 2) / 2) * (1 - (frame.now - n.start) / age);
      const f = flashes.get(key);
      if (f) {
        f.count++;
        f.brightness = Math.max(f.brightness, brightness);
      } else flashes.set(key, { slot, instrument: id, count: 1, brightness });
    });
  }
  return [...flashes.values()];
}

export function featured(cast: Figure[]): Figure[] {
  return cast.filter((f) => f.walking);
}
