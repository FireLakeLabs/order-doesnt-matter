import type { ViewFrame } from '../types';
import { timeline } from '../shared/retro-2d';
export function layout(f: ViewFrame) {
  const left = Math.min(160, f.width * 0.24),
    right = f.width - 45;
  const top = 128,
    bottom = f.height - 80;
  return {
    left,
    right,
    top,
    bottom,
    row: (bottom - top) / Math.max(1, f.instruments.length),
    time: timeline(f, left, right),
  };
}
