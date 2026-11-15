import { laneGeometry, type Size, type ViewSettings } from './model';

/** Perspective of the same helical score, not another time model. Radius is
 * decoded only to find the lane offset; absolute scored times remain untouched.
 * Past planes expand and upcoming planes recede. Reduced motion passes a whole
 * turn as camera time, just as Ring does; only the Now gate then moves within it.
 */
export function depthProjection(count: number, size: Size, camera: number, view: ViewSettings) {
  const g = laneGeometry(count, size, view);
  const extent = Math.max(1, Math.min(size.width, size.height));
  const scale = (time: number) => Math.exp(-0.22 * (time - camera + view.keep));
  return {
    scale,
    width: (time: number) => (extent * 0.16 * scale(time)) / g.pitch,
    point(time: number, radius: number): [number, number] {
      const lane = (radius - g.core - g.pitch * (time - camera + view.keep + 1)) / g.pitch;
      const r = extent * (0.21 + lane * 0.16) * scale(time);
      const angle = (time - camera) * Math.PI * 2 - Math.PI / 2;
      return [Math.cos(angle) * r, Math.sin(angle) * r * 0.72 - (1 - scale(time)) * extent * 0.2];
    },
  };
}
