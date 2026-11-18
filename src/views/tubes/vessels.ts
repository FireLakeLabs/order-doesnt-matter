import { line } from '../shared/retro-2d';
import { clamp } from '../shared/math';
import type { ViewFrame } from '../types';
import type { TubeBox } from './geometry';
import { keyFor } from './model';
import type { TubeMotion } from './motion';

export type Vessel = 'conical' | 'round' | 'speaker' | 'balance' | 'cylinder' | 'tube';
export function vesselFor(name: string): Vessel {
  switch (keyFor(name)) {
    case 'cutoff':
    case 'hcutoff':
    case 'bandf':
    case 'resonance':
    case 'hresonance':
      return 'conical';
    case 'room':
    case 'size':
    case 'delay':
    case 'delaytime':
    case 'delayfeedback':
      return 'round';
    case 'gain':
    case 'velocity':
    case 'postgain':
      return 'speaker';
    case 'pan':
      return 'balance';
    case 'note':
    case 'n':
    case 'freq':
    case 'speed':
      return 'cylinder';
    default:
      return 'tube';
  }
}
/** Octaves are 12 semitones for note/n and doublings for Hz/playback speed. */
export function octaveTicks(name: string, min: number, max: number): number[] {
  if (max <= min) return [];
  const semitones = name === 'note' || name === 'n';
  if (!semitones && min <= 0) return [];
  const low = semitones ? min / 12 : Math.log2(min);
  const high = semitones ? max / 12 : Math.log2(max);
  const ticks: number[] = [];
  for (let i = Math.ceil(low); i <= Math.floor(high); i++) {
    const value = semitones ? i * 12 : 2 ** i;
    ticks.push((value - min) / (max - min));
  }
  return ticks;
}
export function vesselBody(box: TubeBox): TubeBox {
  const kind = vesselFor(box.tube.setting.name);
  const available = box.bottom - box.top;
  const head = Math.min(box.dense ? 24 : 30, available * 0.65);
  const height = available - head;
  const width = kind === 'tube' || kind === 'cylinder' ? box.width * 0.52 : box.width;
  // Keep the bulb round and the cabinets broad even on a tall stage. Cylinders
  // and test tubes use the full height; all bases remain on the same bench.
  const aspect =
    kind === 'round'
      ? 1.45
      : kind === 'conical'
        ? 1.9
        : kind === 'speaker'
          ? 1.65
          : kind === 'balance'
            ? 1
            : Infinity;
  return { ...box, width, top: box.bottom - Math.min(height, width * aspect) };
}
function outline(c: CanvasRenderingContext2D, box: TubeBox, kind: Vessel) {
  const { x, width: w, top, bottom } = box,
    h = bottom - top;
  const point = (u: number, v: number) => [x + u * w, top + v * h] as const;
  const move = (u: number, v: number) => {
    c.moveTo(...point(u, v));
  };
  const to = (u: number, v: number) => {
    c.lineTo(...point(u, v));
  };
  const curve = (a: number, b: number, d: number, e: number, u: number, v: number) => {
    c.bezierCurveTo(...point(a, b), ...point(d, e), ...point(u, v));
  };
  c.beginPath();
  if (kind === 'conical') {
    move(-0.16, 0);
    to(-0.16, 0.25);
    to(-0.5, 0.91);
    curve(-0.54, 1, -0.46, 1, -0.38, 1);
    to(0.38, 1);
    curve(0.46, 1, 0.54, 1, 0.5, 0.91);
    to(0.16, 0.25);
    to(0.16, 0);
  } else if (kind === 'round') {
    move(-0.14, 0);
    to(-0.14, 0.3);
    curve(-0.64, 0.4, -0.6, 1, 0, 1);
    curve(0.6, 1, 0.64, 0.4, 0.14, 0.3);
    to(0.14, 0);
  } else if (kind === 'speaker') {
    c.roundRect(x - w / 2, top, w, h, Math.min(5, w / 10));
  } else if (kind === 'balance') {
    for (const u of [-0.5, 0.1]) c.roundRect(x + u * w, top + h * 0.15, w * 0.4, h * 0.65, 3);
  } else if (kind === 'cylinder') {
    move(-0.5, 0);
    to(-0.5, 0.97);
    to(0.5, 0.97);
    to(0.5, 0);
  } else {
    const r = Math.min(w / 2, h / 2);
    c.moveTo(x - w / 2, top);
    c.lineTo(x - w / 2, bottom - r);
    c.quadraticCurveTo(x - w / 2, bottom, x, bottom);
    c.quadraticCurveTo(x + w / 2, bottom, x + w / 2, bottom - r);
    c.lineTo(x + w / 2, top);
  }
  c.closePath();
}
/** Surface offsets are fractions of vessel height, not accumulated physics. */
function surface(c: CanvasRenderingContext2D, box: TubeBox, motion: TubeMotion) {
  const { x, width: w, top, bottom } = box,
    h = bottom - top;
  const y = bottom - (motion.level ?? 0) * h;
  c.beginPath();
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    const yy = y + h * (motion.tilt * (u * 2 - 1) + motion.ripple * Math.sin(u * Math.PI * 4));
    if (i === 0) c.moveTo(x - w / 2, yy);
    else c.lineTo(x + (u - 0.5) * w, yy);
  }
}
export function drawVessel(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  box: TubeBox,
  motion: TubeMotion,
  active: boolean,
) {
  const kind = vesselFor(box.tube.setting.name);
  const { x, width: w, top, bottom, rack, tube } = box,
    h = bottom - top;
  const { theme } = f;
  // A pan balance is an instrument itself: both cabinets rotate with its beam.
  const value =
    tube.range?.min !== undefined && tube.range.max !== undefined && motion.level !== undefined
      ? tube.range.min + (tube.range.max - tube.range.min) * motion.level
      : (motion.level ?? (kind === 'balance' ? 0.5 : 0));
  c.save();
  if (kind === 'balance') {
    c.translate(x, bottom - h * 0.1);
    c.rotate((clamp(value) - 0.5) * 0.4);
    c.translate(-x, -(bottom - h * 0.1));
  }
  c.save();
  outline(c, box, kind);
  c.clip();
  c.fillStyle = theme.panel;
  c.fillRect(x - w / 2, top, w, h);
  if (motion.level !== undefined) {
    c.globalAlpha = active ? 0.88 : 0.28;
    c.fillStyle = rack.instrument.colour;
    surface(c, box, motion);
    c.lineTo(x + w / 2, bottom);
    c.lineTo(x - w / 2, bottom);
    c.closePath();
    c.fill();
    if (motion.low !== undefined && motion.low !== motion.level) {
      c.globalAlpha = active ? 0.3 : 0.12;
      c.fillStyle = theme.text;
      c.fillRect(x - w / 2, bottom - motion.level * h, w, (motion.level - motion.low) * h);
    }
    c.globalAlpha = active ? 1 : 0.5;
    c.strokeStyle = theme.text;
    c.lineWidth = 1.5;
    surface(c, box, motion);
    c.stroke();
  }
  c.restore();
  c.strokeStyle = theme.muted;
  c.lineWidth = 1.5;
  outline(c, box, kind);
  c.stroke();
  if (kind === 'speaker' || kind === 'balance') {
    const centres = kind === 'balance' ? [x - w * 0.3, x + w * 0.3] : [x];
    for (const [i, cx] of centres.entries()) {
      const level = kind === 'balance' ? (i === 0 ? 1 - clamp(value) : clamp(value)) : clamp(value);
      const radius = Math.min(w * (kind === 'balance' ? 0.15 : 0.38), h * 0.28);
      const cy = top + h * 0.48;
      c.fillStyle = theme.ground;
      c.strokeStyle = theme.muted;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(cx, cy, radius, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.strokeStyle = rack.instrument.colour;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + level * Math.PI * 2);
      c.stroke();
      // Offset and widening ellipse make the cone's outward travel visible.
      const push = level * radius * 0.3;
      c.fillStyle = theme.panel;
      c.strokeStyle = theme.text;
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(
        cx + push,
        cy - push * 0.5,
        radius * (0.4 + level * 0.3),
        radius * 0.62,
        0,
        0,
        Math.PI * 2,
      );
      c.fill();
      c.stroke();
      c.fillStyle = rack.instrument.colour;
      c.beginPath();
      c.arc(cx + push, cy - push * 0.5, radius * 0.16, 0, Math.PI * 2);
      c.fill();
      if (kind === 'balance') {
        c.fillStyle = theme.muted;
        c.font = `8px "${theme.fontMono}"`;
        c.textAlign = 'center';
        c.fillText(i === 0 ? 'L' : 'R', cx, top + h * 0.72);
      }
    }
    if (kind === 'balance') {
      c.strokeStyle = theme.text;
      c.lineWidth = 2;
      line(c, x - w * 0.5, bottom - h * 0.12, x + w * 0.5, bottom - h * 0.12);
    }
  } else {
    c.strokeStyle = theme.muted;
    c.lineWidth = 1;
    const neck = kind === 'conical' ? 0.16 : kind === 'round' ? 0.14 : 0.5;
    line(c, x - w * neck - 2, top, x + w * neck + 2, top);
    if (kind === 'cylinder') {
      line(c, x - w * 0.65, bottom, x + w * 0.65, bottom);
      c.strokeStyle = theme.line;
      for (let i = 1; i < 10; i++) {
        const yy = bottom - (i / 10) * h;
        line(c, x - w / 2, yy, x - w * 0.25, yy);
      }
      c.strokeStyle = theme.muted;
      const { min, max } = tube.range ?? {};
      if (min !== undefined && max !== undefined)
        for (const tick of octaveTicks(keyFor(tube.setting.name), min, max)) {
          const yy = bottom - tick * h;
          line(c, x - w / 2, yy, x + w * 0.05, yy);
        }
    }
    // A narrow highlight reads as glass even with a flat setting.
    c.strokeStyle = theme.line;
    line(c, x - w * neck + 3, top + 5, x - w * neck + 3, top + h * 0.2);
  }
  c.restore();
  if (kind === 'balance') {
    c.fillStyle = theme.muted;
    c.beginPath();
    c.moveTo(x, bottom - h * 0.15);
    c.lineTo(x - 5, bottom);
    c.lineTo(x + 5, bottom);
    c.closePath();
    c.fill();
  }
}
