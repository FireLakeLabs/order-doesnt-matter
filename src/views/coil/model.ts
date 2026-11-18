import type { ViewFrame } from '../types';
import { TAU } from '../shared/ring-model';

export function coilRange(frame: Pick<ViewFrame, 'sections' | 'now'>) {
  const length = frame.sections.at(-1)?.to ?? 16;
  const from = Math.max(0, Math.floor(frame.now / length) * length);
  return { from, to: from + length, length, open: frame.sections.length === 0, pitch: 10 / length };
}
/** A continuous helix: the end of one cycle is the start of the next. */
export function helixPoint(time: number, from: number, length: number, radius = 1) {
  return {
    x: ((time - from) / length - 0.5) * 10,
    y: Math.cos(time * TAU) * radius,
    z: Math.sin(time * TAU) * radius,
  };
}
export function coilDetail(cycle: number, now: number, length: number) {
  return length <= 64 || Math.abs(cycle - Math.floor(now)) <= 3;
}

/** Perspective fitting leaves room for section names and the controls. */
export function coilPose(frame: Pick<ViewFrame, 'width' | 'height'>) {
  return {
    distance: Math.max(
      4 / Math.tan(Math.PI / 8),
      6.1 / ((Math.tan(Math.PI / 8) * frame.width) / frame.height),
    ),
  };
}
export const clampPitch = (pitch: number) =>
  Math.max((-85 * Math.PI) / 180, Math.min((85 * Math.PI) / 180, pitch));
