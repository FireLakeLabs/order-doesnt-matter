import { clamp } from '../shared/math';
import { nextSample, sampleRack, tubeAt, type PartIndex, type Tube } from './model';

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
  if (!sample.hasOnset) {
    // No invented impulses for fragments/signals: interpolate their available
    // samples directly, without an onset ease or a settling surface.
    const next = nextSample(part.notes, sample.start);
    if (!next || next.hasOnset) return still;
    const target = tubeAt(part, tube.setting, sampleRack(part, next.start));
    const progress = clamp((now - sample.start) / (next.start - sample.start));
    const mix = (a: number | undefined, b: number | undefined) =>
      a === undefined || b === undefined ? a : a + (b - a) * progress;
    return { ...still, level: mix(tube.level, target.level), low: mix(tube.low, target.low) };
  }
  const rate = Math.max(cps, Number.EPSILON);
  const age = Math.max(0, (now - sample.start) / rate);
  // Start from the exact pre-onset rack, including older held voices and
  // notes ending here, rather than revisiting the previous note's start.
  const before = tubeAt(part, tube.setting, sampleRack(part, sample.start, 'before'));
  if (before.level === undefined) return { ...still, age };
  const next = nextSample(part.onsets, sample.start);
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
