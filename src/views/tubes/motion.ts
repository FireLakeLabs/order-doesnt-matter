import { clamp } from '../shared/math';
import { sampleRack, tubeAt, type PartIndex, type Tube } from './model';

export interface TubeMotion {
  level: number | undefined;
  low: number | undefined;
  tilt: number;
  ripple: number;
  age: number | undefined;
}
/** Time is supplied by the host. Nothing here depends on the last frame drawn. */
export function tubeMotion(
  part: PartIndex | undefined,
  tube: Tube,
  now: number,
  cps: number,
): TubeMotion {
  const still: TubeMotion = {
    level: tube.level,
    low: tube.low,
    tilt: 0,
    ripple: 0,
    age: undefined,
  };
  const sample = tube.sample;
  if (!part || !sample || !tube.moving || tube.level === undefined) return still;
  // The last strictly earlier start and first strictly later onset. Equal-time
  // voices are one transition, preserving the full polyphonic band.
  let lo = 0,
    hi = part.notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (part.notes[mid].start < sample.start) lo = mid + 1;
    else hi = mid;
  }
  if (!sample.hasOnset) {
    // No invented impulses for fragments/signals: interpolate their available
    // samples directly, without an onset ease or a settling surface.
    const next = part.notes.find((n) => n.start > sample.start);
    if (!next || next.hasOnset) return still;
    const target = tubeAt(part, tube.setting, sampleRack(part, next.start));
    const progress = clamp((now - sample.start) / (next.start - sample.start));
    const mix = (a: number | undefined, b: number | undefined) =>
      a === undefined || b === undefined ? a : a + (b - a) * progress;
    return { ...still, level: mix(tube.level, target.level), low: mix(tube.low, target.low) };
  }
  const rate = Math.max(cps, Number.EPSILON);
  const age = Math.max(0, (now - sample.start) / rate);
  if (lo === 0) return { ...still, age };
  const previous = part.notes[lo - 1];
  const before = tubeAt(part, tube.setting, sampleRack(part, previous.start));
  if (before.level === undefined) return { ...still, age };
  const next = part.onsets.find((n) => n.start > sample.start);
  const duration = Math.min(0.12, next ? (0.4 * (next.start - sample.start)) / rate : 0.12);
  const ease = 1 - (1 - clamp(age / duration)) ** 3;
  const delta = tube.level - before.level;
  const lowDelta = (tube.low ?? tube.level) - (before.low ?? before.level);
  const settling = Math.max(0, age - duration);
  // Tilt + ripple never exceed 4% of vessel height together. The envelope
  // starts at zero and ends exactly at zero after 400 ms.
  const envelope = age < duration ? 0 : Math.exp(-8 * settling) * (1 - clamp(settling / 0.4));
  const impulse = Math.max(
    -1,
    Math.min(1, 4 * (Math.abs(delta) >= Math.abs(lowDelta) ? delta : lowDelta)),
  );
  return {
    level: before.level + delta * ease,
    low: (before.low ?? before.level) + lowDelta * ease,
    tilt: 0.028 * impulse * envelope * Math.sin(settling * 42),
    ripple: 0.012 * Math.abs(impulse) * envelope * Math.sin(settling * 67),
    age,
  };
}
