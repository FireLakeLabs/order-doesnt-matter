import type { ViewFrame } from '../types';
import { clamp } from '../shared/math';
import type { Mark } from './model';

export interface StageBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface Spot {
  mark: Mark;
  x: number;
  y: number;
  trueX: number;
  trueY: number;
  radius: number;
  labelWidth: number;
  compact: boolean;
}
export function stageBox(frame: Pick<ViewFrame, 'width' | 'height'>): StageBox {
  return {
    left: frame.width < 700 ? 50 : 70,
    right: frame.width - 26,
    top: 112,
    bottom: frame.height - 80,
  };
}
export function truePlace(box: StageBox, pan: number, room: number) {
  return {
    x: box.left + 42 + pan * (box.right - box.left - 84),
    y: box.bottom - 42 - room * (box.bottom - box.top - 84),
  };
}
export function radiusOf(frame: Pick<ViewFrame, 'width' | 'height'>, gain: number): number {
  return 3 + clamp(Math.min(frame.width, frame.height) * 0.037, 12, 25) * Math.sqrt(gain);
}
/** Place labels and circles together. Fan displacement is display-only; every
 * displaced spot keeps a hairline to its unmodified pan/send coordinate. */
export function stageLayout(
  frame: Pick<ViewFrame, 'width' | 'height'>,
  marks: Mark[],
  measure: (text: string) => number,
): { box: StageBox; spots: Spot[] } {
  const box = stageBox(frame);
  const compact = marks.length > (frame.width < 700 ? 8 : 16);
  const spots: Spot[] = [];
  const occupied: { x: number; y: number; width: number; height: number }[] = [];
  const coincident = new Map<string, Mark[]>();
  for (const mark of marks) {
    const key = `${String(mark.pan)}:${String(mark.room)}`;
    const group = coincident.get(key) ?? [];
    group.push(mark);
    coincident.set(key, group);
  }
  for (const mark of marks) {
    const truePoint = truePlace(box, mark.pan, mark.room);
    const radius = radiusOf(frame, mark.gain) * (compact ? 0.7 : 1);
    const label = mark.instruments[0].name;
    const labelWidth = compact
      ? Math.max(34, radius * 2)
      : Math.min(frame.width < 700 ? 112 : 160, Math.max(radius * 2, measure(label) + 8, 96));
    const width = labelWidth + 8,
      height = radius * 2 + (compact ? 17 : 37);
    const group = coincident.get(`${String(mark.pan)}:${String(mark.room)}`) ?? [mark];
    const separation = compact
      ? 58
      : Math.max(
          104,
          ...group.map((m) =>
            Math.min(frame.width < 700 ? 112 : 160, measure(m.instruments[0].name) + 8),
          ),
        ) + 12;
    const span = (group.length - 1) * separation;
    const fanX =
      span <= box.right - box.left - width - 8
        ? clamp(
            truePoint.x - span / 2,
            box.left + width / 2 + 4,
            box.right - width / 2 - 4 - span,
          ) +
          group.indexOf(mark) * separation
        : truePoint.x;
    let best: { x: number; y: number; distance: number } | undefined;
    // A bounded deterministic packing search, not an evolving force layout.
    const stepX = compact ? 56 : Math.min(110, width),
      stepY = compact ? 58 : 80;
    const candidates = [{ x: fanX, y: truePoint.y }];
    for (let x = box.left + width / 2 + 5; x < box.right - width / 2; x += stepX)
      candidates.push({ x, y: truePoint.y });
    for (let y = box.top + radius + 8; y < box.bottom - height + radius; y += stepY)
      candidates.push({ x: truePoint.x, y });
    for (let y = box.top + radius + 8; y < box.bottom - height + radius; y += stepY)
      for (let x = box.left + width / 2 + 5; x < box.right - width / 2; x += stepX)
        candidates.push({ x, y });
    for (const candidate of candidates) {
      const x = clamp(candidate.x, box.left + width / 2 + 4, box.right - width / 2 - 4);
      const y = clamp(candidate.y, box.top + radius + 6, box.bottom - radius - (compact ? 19 : 39));
      const rect = { x: x - width / 2, y: y - radius - 4, width, height };
      if (
        mark.room > 0
          ? spots.some((s) => Math.hypot(x - s.x, y - s.y) < radius + s.radius)
          : occupied.some(
              (o) =>
                rect.x < o.x + o.width &&
                rect.x + rect.width > o.x &&
                rect.y < o.y + o.height &&
                rect.y + rect.height > o.y,
            )
      )
        continue;
      const distance = (x - fanX) ** 2 + 25 * (y - truePoint.y) ** 2;
      if (!best || distance < best.distance) best = { x, y, distance };
    }
    const point = best ?? {
      x: clamp(truePoint.x, box.left + radius, box.right - radius),
      y: clamp(truePoint.y, box.top + radius, box.bottom - radius - 20),
    };
    occupied.push({ x: point.x - width / 2, y: point.y - radius - 4, width, height });
    spots.push({
      mark,
      ...point,
      trueX: truePoint.x,
      trueY: truePoint.y,
      radius,
      labelWidth,
      compact,
    });
  }
  return { box, spots };
}
