import type { ViewFrame, ViewNote } from '../types';

export const TAU = Math.PI * 2;
export const DENSE_AT = 128;
export const TEXTURE_SIZE = 2048;
export interface Band {
  id: string;
  radius: number;
  width: number;
  resting: boolean;
}
export interface Arc {
  from: number;
  to: number;
  start: number;
  end: number;
  onset: boolean;
}
export function cycleArcs(notes: readonly ViewNote[], cycle: number): Arc[] {
  return (
    notes
      .flatMap((note) => {
        const from = Math.max(cycle, note.start);
        const to = Math.min(cycle + 1, note.end);
        return to > from
          ? [
              {
                from: from - cycle,
                to: to - cycle,
                start: note.start - cycle,
                end: note.end - cycle,
                onset: note.hasOnset,
              },
            ]
          : [];
      })
      // Whole-span continuations must not cover the onset-bearing geometry.
      .sort((a, b) => Number(a.onset) - Number(b.onset) || a.start - b.start)
  );
}
/** Short hits read as separated ticks; timing retains the real sounding span.
 * Below 2% spacing display ticks can join. Dense cycles retain exact occupancy.
 * Continuations keep their clipped real span; ticks never wrap into another cycle. */
export function displayArcs(arcs: readonly Arc[]): Arc[] {
  return arcs.map((arc) => {
    if (!arc.onset || arc.end - arc.start > 0.2 || arc.start < 0) return arc;
    const width = Math.max(0.02, Math.min(0.035, (arc.end - arc.start) * 0.65));
    return { ...arc, to: Math.min(1, arc.from + width) };
  });
}
/** Upcoming events live clockwise of the fixed gate; increasing now turns anticlockwise. */
export function ringAngle(time: number, now: number) {
  return (time - now) * TAU;
}
export function sectionAt(frame: Pick<ViewFrame, 'sections' | 'now'>) {
  const length = frame.sections.at(-1)?.to ?? 0;
  const offset = length > 0 ? Math.floor(frame.now / length) * length : 0;
  const section = frame.sections.find(
    (section) => frame.now - offset >= section.from && frame.now - offset < section.to,
  );
  return section ? { ...section, from: section.from + offset, to: section.to + offset } : undefined;
}
/** Long held notes earn radial weight. Even 20 bands fit at >=10 px on a 760 px stage. */
export function bandLayout(frame: ViewFrame, previous = false): Band[] {
  const section = sectionAt(frame);
  const cycle = section ? section.from - 1 : Math.floor(frame.now) - 1;
  const from = previous ? cycle : (section?.from ?? frame.from);
  const to = previous ? cycle + 1 : (section?.to ?? frame.to);
  const stats = new Map<string, { count: number; duration: number }>();
  for (const note of frame.notes) {
    const duration = Math.min(to, note.end) - Math.max(from, note.start);
    if (duration <= 0) continue;
    const stat = stats.get(note.instrument) ?? { count: 0, duration: 0 };
    stat.count++;
    stat.duration += duration;
    stats.set(note.instrument, stat);
  }
  const instruments = [...frame.instruments].sort((a, b) => a.index - b.index);
  const active = instruments.filter((instrument) =>
    previous ? stats.has(instrument.id) : instrument.inSection,
  );
  const activeIds = new Set(active.map(({ id }) => id));
  const resting = instruments.filter(({ id }) => !activeIds.has(id));
  const pixelRadius = Math.max(1, Math.min(frame.width, frame.height) * 0.42);
  const minimum = Math.min(10 / pixelRadius, 0.64 / Math.max(1, active.length));
  const gap = Math.min(
    5 / pixelRadius,
    (Math.max(0, 0.64 - minimum * active.length) / Math.max(1, active.length - 1)) * 0.3,
  );
  const extra = Math.max(0, 0.64 - minimum * active.length - gap * (active.length - 1));
  const weights = active.map(({ id }) => {
    const stat = stats.get(id);
    return Math.sqrt(stat ? stat.duration / stat.count : 0.05);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let edge = 0.28;
  return [
    ...active.map(({ id }, index) => {
      const width = minimum + (extra * weights[index]) / total;
      const radius = edge + width / 2;
      edge += width + gap;
      return { id, radius, width, resting: false };
    }),
    ...resting.map(({ id }, index) => ({
      id,
      radius: 0.945 + ((index + 1) / (resting.length + 1)) * 0.055,
      width: 0.8 / pixelRadius,
      resting: true,
    })),
  ];
}
export function ghostBand(band: Band, bands: readonly Band[], pixelRadius: number) {
  const inner = band.radius + band.width / 2;
  let outer = 1.02;
  for (const other of bands) {
    if (other.id !== band.id && other.radius >= band.radius)
      outer = Math.min(outer, other.radius - other.width / 2);
  }
  const gap = Math.max(0, outer - inner);
  return {
    radius: inner + gap / 2,
    width: Math.min(Math.max(1.25 / pixelRadius, band.width * 0.075), gap * 0.65),
  };
}
export function sectionEase(frame: ViewFrame) {
  const section = sectionAt(frame);
  const t =
    section && section.from > 0 ? Math.max(0, Math.min(1, (frame.now - section.from) / 0.5)) : 1;
  return t * t * (3 - 2 * t);
}
export function trailDuration(trails: 0 | 1 | 2) {
  return trails === 1 ? 0.25 : trails === 2 ? 1 : 0;
}
/** Area coverage, not sampled hits: every span contributes, even below a texel's width. */
export function occupancy(arcs: readonly Arc[], size = TEXTURE_SIZE) {
  const data = new Float32Array(size * 4);
  for (const arc of arcs) {
    for (let bin = Math.floor(arc.from * size); bin < Math.ceil(arc.to * size); bin++) {
      if (bin < 0 || bin >= size) continue;
      const offset = bin * 4;
      const coverage = (Math.min(arc.to, (bin + 1) / size) - Math.max(arc.from, bin / size)) * size;
      data[offset] = Math.min(1, data[offset] + coverage);
      // Preserve an onset separately from a continuation, independent of note ordering.
      if (
        !data[offset + 3] ||
        (arc.onset && (data[offset + 3] < 0 || arc.start >= data[offset + 1]))
      ) {
        data[offset + 1] = arc.start;
        data[offset + 2] = arc.end;
        data[offset + 3] = arc.onset ? 1 : -1;
      } else data[offset + 2] = Math.max(data[offset + 2], arc.end);
    }
  }
  return data;
}
/** Unit annulus strips: radius/width are uniforms so section changes need no mesh rebuild. */
export function arcVertices(arcs: readonly Arc[], depth = 0.028) {
  const stepsFor = (arc: Arc) => Math.max(1, Math.ceil((arc.to - arc.from) * 128));
  const length = arcs.reduce((count, arc) => count + stepsFor(arc) * 54, 0);
  const positions = new Float32Array(length);
  const timing = new Float32Array(length);
  const surfaces = new Float32Array(length);
  let offset = 0;
  const vertex = (time: number, radial: number, z: number, arc: Arc, shade: number) => {
    positions[offset] = time * TAU;
    positions[offset + 1] = radial;
    positions[offset + 2] = z;
    timing[offset] = arc.start;
    timing[offset + 1] = arc.end;
    timing[offset + 2] = arc.onset ? 1 : 0;
    surfaces[offset] = time;
    surfaces[offset + 1] = radial + 0.5;
    surfaces[offset + 2] = shade;
    offset += 3;
  };
  const quad = (
    a: number,
    b: number,
    r0: number,
    r1: number,
    z0: number,
    z1: number,
    arc: Arc,
    shade: number,
  ) => {
    vertex(a, r0, z0, arc, shade);
    vertex(b, r0, z0, arc, shade);
    vertex(b, r1, z1, arc, shade);
    vertex(a, r0, z0, arc, shade);
    vertex(b, r1, z1, arc, shade);
    vertex(a, r1, z1, arc, shade);
  };
  for (const arc of arcs) {
    const steps = stepsFor(arc);
    for (let step = 0; step < steps; step++) {
      const a = arc.from + ((arc.to - arc.from) * step) / steps;
      const b = arc.from + ((arc.to - arc.from) * (step + 1)) / steps;
      quad(a, b, -0.5, 0.5, depth, depth, arc, 1);
      quad(a, b, 0.5, 0.5, 0, depth, arc, 0.42);
      quad(a, b, -0.5, -0.5, 0, depth, arc, 0.55);
    }
  }
  return { positions, timing, surfaces };
}
