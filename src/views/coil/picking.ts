import type * as Three from 'three';
import type { ViewFrame, ViewNote } from '../types';
import { cycleScore } from '../shared/cycle-score';
import { helixPoint } from './model';

interface Surface {
  cycle: number;
  note?: ViewNote;
  depth: number;
  points: { x: number; y: number; z: number; time: number }[];
}
/** CPU ribbons mirror the shader's helix, including the playhead enlargement.
 * Kept separately because the GPU mesh stores time/radius rather than world positions. */
export function pickSurfaces(frame: ViewFrame, from: number, to: number): Surface[] {
  const result: Surface[] = [];
  const add = (
    cycle: number,
    start: number,
    end: number,
    radius: number,
    width: number,
    note?: ViewNote,
  ) => {
    const steps = Math.max(1, Math.ceil((end - start) * 64));
    const points: Surface['points'] = [];
    for (let step = 0; step <= steps; step++) {
      const time = start + ((end - start) * step) / steps;
      for (const edge of [-0.5, 0.5])
        points.push({ ...helixPoint(time, from, to - from, radius + width * edge), time });
    }
    result.push({ cycle, note, points, depth: note ? 0.003 : -0.003 });
  };
  for (let cycle = from; cycle < to; cycle++) {
    add(cycle, cycle, cycle + 1, 1.025, 0.012);
    for (const band of cycleScore(frame, cycle)) {
      add(cycle, cycle, cycle + 1, band.radius, 0.006);
      for (const note of frame.notes)
        if (note.instrument === band.id && note.start < cycle + 1 && note.end > cycle)
          add(
            cycle,
            Math.max(cycle, note.start),
            Math.min(cycle + 1, note.end),
            band.radius,
            band.width,
            note,
          );
    }
  }
  return result;
}
export function pickSurface(THREE: typeof Three, ray: Three.Ray, surfaces: Surface[], now: number) {
  const a = new THREE.Vector3(),
    b = a.clone(),
    c = a.clone(),
    hit = a.clone();
  let closest = Infinity,
    result: Surface | undefined;
  const set = (v: Three.Vector3, p: Surface['points'][number], depth: number) => {
    const d = (p.time - now) / 0.7,
      scale = 1 + (Math.abs(d) < 2 ? Math.exp(-d * d * d * d) * 0.16 : 0);
    v.set(p.x, p.y * scale, p.z * scale + depth);
  };
  for (const surface of surfaces)
    for (let i = 0; i < surface.points.length - 2; i++) {
      set(a, surface.points[i], surface.depth);
      set(b, surface.points[i + 1], surface.depth);
      set(c, surface.points[i + 2], surface.depth);
      if (ray.intersectTriangle(a, b, c, false, hit)) {
        const distance = hit.distanceToSquared(ray.origin);
        if (distance < closest) {
          closest = distance;
          result = surface;
        }
      }
    }
  return result;
}
