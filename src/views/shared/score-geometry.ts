import type { Arc } from './ring-model';
export interface ScoreStrip {
  cycle: number;
  radius: number;
  width: number;
  colour: string;
  muted: boolean;
  arcs: (Arc & { coverage?: number })[];
  track?: boolean;
  segments?: number;
}
export interface LightRange {
  start: number;
  end: number;
  onset: boolean;
  first: number;
  count: number;
}
/** Indexed ribbons share edge vertices. Helix trigonometry is static score data,
 * so the GPU only applies the playing-loop enlargement each frame. */
export function scoreGeometry(
  strips: ScoreStrip[],
  rgb: (colour: string) => readonly number[],
  helix = false,
) {
  const positions: number[] = [],
    timing: number[] = [],
    bands: number[] = [],
    inks: number[] = [],
    quiet: number[] = [],
    curves: number[] = [];
  const lods = [1, 2, 4].map((stride) => ({
    stride,
    indices: [] as number[],
    lights: [] as LightRange[],
  }));
  for (const strip of strips) {
    const ink = rgb(strip.colour);
    for (const arc of strip.arcs) {
      const perCycle = helix ? Math.min(strip.segments ?? 128, 64) : (strip.segments ?? 128);
      const steps = Math.max(1, Math.ceil((arc.to - arc.from) * perCycle));
      const firstVertex = positions.length / 3;
      for (let i = 0; i <= steps; i++) {
        const time = strip.cycle + arc.from + ((arc.to - arc.from) * i) / steps;
        const sin = Math.sin(time * Math.PI * 2),
          cos = Math.cos(time * Math.PI * 2);
        for (const radial of [-0.5, 0.5]) {
          positions.push(time, radial, strip.track ? -0.003 : 0.003);
          timing.push(
            strip.cycle + arc.start,
            strip.cycle + arc.end,
            strip.track ? -1 : arc.onset ? 1 : 0,
          );
          bands.push(strip.radius, strip.width, arc.coverage ?? 1);
          inks.push(ink[0], ink[1], ink[2]);
          quiet.push(strip.muted ? 0.23 : 1);
          if (helix) {
            const r = strip.radius + radial * strip.width;
            curves.push(sin * r, cos * r, sin);
          }
        }
      }
      for (const lod of lods) {
        const firstIndex = lod.indices.length;
        const stride = Math.min(lod.stride, Math.max(1, Math.floor(perCycle / 16)));
        for (let i = 0; i < steps; i += stride) {
          const a = firstVertex + i * 2,
            b = firstVertex + Math.min(steps, i + stride) * 2;
          lod.indices.push(a, b, b + 1, a, b + 1, a + 1);
        }
        if (!strip.track)
          lod.lights.push({
            start: strip.cycle + arc.start,
            end: strip.cycle + arc.end,
            onset: arc.onset,
            first: firstIndex,
            count: lod.indices.length - firstIndex,
          });
      }
    }
  }
  const layouts = lods.map((lod) => ({
    indices: new Uint32Array(lod.indices),
    lights: lod.lights,
  }));
  return {
    positions: new Float32Array(positions),
    timing: new Float32Array(timing),
    bands: new Float32Array(bands),
    inks: new Float32Array(inks),
    quiet: new Float32Array(quiet),
    curves: new Float32Array(curves),
    indices: layouts[0].indices,
    lights: layouts[0].lights,
    lods: layouts,
  };
}
/** Includes every sounding continuation and onset flash; non-emitting geometry
 * between them may remain in the contiguous draw, but distant cycles need not. */
export function lightRange(arcs: LightRange[], now: number, flashDuration: number) {
  let first = Infinity,
    last = 0;
  for (const arc of arcs)
    if (
      (now >= arc.start && now < arc.end) ||
      (arc.onset && now >= arc.start && now - arc.start < flashDuration)
    ) {
      first = Math.min(first, arc.first);
      last = Math.max(last, arc.first + arc.count);
    }
  return {
    start: Number.isFinite(first) ? first : 0,
    count: Number.isFinite(first) ? last - first : 0,
  };
}
