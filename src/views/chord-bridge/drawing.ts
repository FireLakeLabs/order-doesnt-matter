import { noteName, pitchClass } from '../shared/pitch';
import { clamp } from '../shared/math';
import type { Bridge, Pier } from './model';

const signatures = [0, -5, 2, -3, 4, -1, -6, 1, -4, 3, -2, 5];
const scales = [
  [0, 2, 4, 5, 7, 9, 11],
  [0, 2, 3, 5, 7, 8, 10],
  [0, 2, 3, 5, 7, 8, 11],
];
/** Accidental preference, not a claimed key: fewest foreign pitch classes,
 * then the simplest key signature among major and minor scale candidates. */
export function accidentalStyle(pitches: readonly number[]): 'flats' | 'sharps' {
  const classes = new Set(pitches.map(pitchClass));
  let best = Infinity,
    signature = 0;
  for (let root = 0; root < 12; root++)
    scales.forEach((scale, mode) => {
      const members = new Set(scale.map((p) => (p + root) % 12));
      const key = signatures[(root + (mode ? 3 : 0)) % 12];
      const score = [...classes].filter((p) => !members.has(p)).length * 100 + Math.abs(key);
      if (score < best) {
        best = score;
        signature = key;
      }
    });
  return signature < 0 ? 'flats' : 'sharps';
}
const flats = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export function spell(midi: number, style: 'flats' | 'sharps') {
  const name =
    style === 'flats'
      ? `${flats[pitchClass(midi)]}${String(Math.floor(Math.round(midi) / 12) - 1)}`
      : noteName(midi);
  return name + (Math.abs(midi - Math.round(midi)) > 1e-6 ? '~' : '');
}
export function presentation(bridge: Bridge) {
  const pitches = bridge.piers.flatMap((p) => p.tones.map((t) => t.midi));
  const low = pitches.length ? Math.floor(Math.min(...pitches) / 3) * 3 : 36;
  const high = pitches.length
    ? Math.max(low + 12, Math.floor(Math.max(...pitches) / 3) * 3 + 3)
    : 72;
  return { low, high, spelling: accidentalStyle(bridge.tones.map((t) => t.midi)) };
}
export function bridgeLayout(
  width: number,
  height: number,
  range: { from: number; to: number },
  register: ReturnType<typeof presentation>,
) {
  const side = width < 700 ? 116 : 152;
  const left = 24,
    right = width - side - 28,
    top = 188,
    ground = height - 55,
    bottom = ground - 30;
  const blockWidth = width < 700 ? 52 : 78;
  const inset = blockWidth / 2 + 6;
  return {
    left,
    right,
    side,
    top,
    bottom,
    ground,
    blockWidth,
    x: (time: number) =>
      left + inset + ((time - range.from) / (range.to - range.from)) * (right - left - 2 * inset),
    y: (midi: number) =>
      bottom - clamp((midi - register.low) / (register.high - register.low)) * (bottom - top),
    melodyY: (midi: number) => 144 - clamp((midi - 36) / 60) * 26,
  };
}
export type BridgeLayout = ReturnType<typeof bridgeLayout>;
/** Structural attachment points on the facing edges of the named blocks. */
export function girderEnds(from: number, to: number, width: number) {
  return to - from > width + 8 ? { from: from + width / 2 + 8, to: to - width / 2 } : { from, to };
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const intersects = (a: Rect, b: Rect, margin = 4) =>
  a.x < b.x + b.w + margin &&
  a.x + a.w + margin > b.x &&
  a.y < b.y + b.h + margin &&
  a.y + a.h + margin > b.y;

/** Fixed bands across the full queried chord register, never the active siblings. */
export function stoneBlocks(pier: Pier, box: BridgeLayout) {
  const bands = new Map<number, Pier['tones']>();
  for (const tone of pier.tones) {
    const band = Math.floor((box.y(tone.midi) - box.top) / 30);
    const tones = bands.get(band) ?? [];
    tones.push(tone);
    bands.set(band, tones);
  }
  return [...bands].map(([band, tones]) => ({
    x: box.x(pier.start) - box.blockWidth / 2,
    y: box.top + band * 30 + 1,
    w: box.blockWidth,
    h: 28,
    tones,
  }));
}
