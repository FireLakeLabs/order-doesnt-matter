import type { ViewFrame, ViewNote } from '../types';
import { clamp } from '../shared/math';
import { roleEvidence, lowestPitchedPart } from '../shared/roles';

export type Shape = 'crystal' | 'bead' | 'leaf';
export interface MobileScore {
  notes: ViewNote[];
  shapes: Map<string, Shape>;
}
/** Whole-span control fragments are one weight; coincident onset voices remain polyphony. */
export function indexMobile(source: ViewNote[]): MobileScore {
  const identity = (n: ViewNote) =>
    JSON.stringify([
      n.instrument,
      n.start,
      n.end,
      Object.keys(n.value)
        .sort()
        .map((k) => [k, n.value[k]]),
    ]);
  const onsets = new Set(source.filter((n) => n.hasOnset).map(identity));
  const seen = new Set<string>();
  const notes = source.filter((n) => {
    if (n.hasOnset) return true;
    const key = identity(n);
    if (onsets.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // n may select a sample; only note/frequency establishes pitch here, as in Dancer.
  const evidence = roleEvidence(notes.map((n) => ({ ...n, value: { ...n.value, n: undefined } })));
  const lowest = lowestPitchedPart(evidence);
  const shapes = new Map<string, Shape>();
  for (const p of evidence.values()) {
    shapes.set(
      p.id,
      Number.isFinite(p.meanPitch)
        ? p.meanPitch < 48 || p.id === lowest
          ? 'crystal'
          : 'leaf'
        : p.hits.length && p.duration <= 0.5
          ? 'bead'
          : 'leaf',
    );
  }
  return { notes, shapes };
}
export function mass(note: ViewNote): number {
  const gain =
    typeof note.value.gain === 'number' && Number.isFinite(note.value.gain)
      ? Math.max(0, note.value.gain)
      : 1;
  return Math.max(0, note.end - note.start) * gain;
}
/** Cycle-aged, analytic motion; fragments and future onsets never acquire an impulse. */
export function swing(note: ViewNote, now: number): number {
  const age = now - note.start;
  return note.hasOnset && age >= 0 ? Math.exp(-age * 3.2) * Math.sin(age * 13) : 0;
}
export function mobileWindow(frame: Pick<ViewFrame, 'now' | 'lookAhead'>) {
  const from = Math.floor(frame.now);
  return { from, to: from + Math.max(1, frame.lookAhead) };
}
export interface Weight {
  slot: number;
  position: number;
  notes: ViewNote[];
  mass: number;
  swing: number;
  passed: number;
}
export interface Arm {
  id: string;
  shape: Shape;
  notes: ViewNote[];
  weights: Weight[];
  mass: number;
  moment: number;
  tilt: number;
}
/** Fixed onset slots retain identity when siblings disappear. All members contribute
 * their actual onset moment and span × gain, even when represented by one counted weight. */
export function mobileArms(
  frame: ViewFrame,
  score: MobileScore,
  order: readonly string[] = [],
  slots = 9,
): Arm[] {
  const { from, to } = mobileWindow(frame);
  const parts = [...frame.instruments].sort(
    (a, b) => a.index - b.index || a.id.localeCompare(b.id),
  );
  const rank = new Map(order.map((id, i) => [id, i]));
  parts.sort(
    (a, b) =>
      (rank.get(a.id) ?? order.length + a.index) - (rank.get(b.id) ?? order.length + b.index),
  );
  const groups = new Map<string, ViewNote[]>();
  for (const n of score.notes) {
    if (n.start >= to || n.end <= from) continue;
    const group = groups.get(n.instrument) ?? [];
    group.push(n);
    groups.set(n.instrument, group);
  }
  return parts.flatMap((part) => {
    const notes = groups.get(part.id);
    if (!notes?.length) return [];
    const weights = new Map<number, Weight>();
    let total = 0,
      moment = 0;
    for (const n of notes) {
      const position = clamp((n.start - from) / (to - from)) * 2 - 1;
      const slot = Math.round(((position + 1) / 2) * (slots - 1));
      const m = mass(n);
      const weight = weights.get(slot) ?? {
        slot,
        position: (slot / (slots - 1)) * 2 - 1,
        notes: [],
        mass: 0,
        swing: 0,
        passed: 0,
      };
      weight.notes.push(n);
      weight.mass += m;
      weight.swing += swing(n, frame.now);
      weight.passed += Number(n.start <= frame.now);
      weights.set(slot, weight);
      total += m;
      moment += position * m;
    }
    const sorted = [...weights.values()].sort((a, b) => a.slot - b.slot);
    for (const w of sorted) w.swing /= w.notes.length;
    return [
      {
        id: part.id,
        shape: score.shapes.get(part.id) ?? 'leaf',
        notes,
        weights: sorted,
        mass: total,
        moment,
        tilt: total > 0 ? clamp(moment / total, -1, 1) * 0.19 : 0,
      },
    ];
  });
}
export const areaFactor = (shape: Shape) =>
  shape === 'bead' ? Math.PI : shape === 'crystal' ? 6 : 2.8;
export const tiltName = (tilt: number) =>
  Math.abs(tilt) < 0.001 ? 'level' : tilt < 0 ? 'left dips' : 'right dips';
export function reorder(order: readonly string[], moving: string, target: string) {
  if (moving === target || !order.includes(moving) || !order.includes(target)) return [...order];
  const next = order.filter((id) => id !== moving);
  next.splice(order.indexOf(target), 0, moving);
  return next;
}
export function mobileLayout(width: number, height: number, arms: number) {
  const count = Math.max(1, arms);
  const bay = (width - 40) / count;
  const slots = Math.max(3, Math.min(9, Math.floor(bay / 24) * 2 - 1));
  const footer = width < 700 ? 98 : 78;
  const top = 75,
    bottom = Math.max(top + 20, height - footer - 12);
  const canopy = Math.min((bottom - top) * 0.22, 90);
  const armY = top + canopy + (bottom - top - canopy) * 0.18;
  const half = Math.max(1, bay * 0.36);
  const stagger = Math.max(0, (bottom - armY - 65) * 0.12);
  const armYs = Array.from({ length: count }, (_, i) => armY + ((i % 3) - 1) * stagger);
  const room = Math.max(5, bottom - 65 - armY - stagger - half * 0.2);
  const maxRadius = room * 0.25;
  return {
    bay,
    slots,
    footer,
    top,
    bottom,
    canopy,
    armY,
    armYs,
    half,
    maxRadius,
    centers: Array.from({ length: count }, (_, i) => 20 + (i + 0.5) * bay),
  };
}
export type MobileLayout = ReturnType<typeof mobileLayout>;
/** One area unit across every arm and every shape. Crowding reduces the common
 * scale, never clips gain or substitutes a minimum filled weight. */
export function areaUnit(arms: Arm[], box: MobileLayout) {
  let unit = 9600;
  for (const arm of arms) {
    for (const w of arm.weights) {
      if (!w.mass) continue;
      const neighbour = Math.min(
        ...arm.weights
          .filter((other) => other !== w)
          .map((other) => Math.abs(other.position - w.position) * box.half),
      );
      const radius = Math.min(box.maxRadius, Math.max(0.1, box.bay * 0.14 - 4), neighbour * 0.42);
      unit = Math.min(unit, (areaFactor(arm.shape) * radius * radius) / w.mass);
    }
  }
  return unit;
}
/** One shared drop puts the lowest weight just above the count/part labels. */
export function weightDrop(arms: Arm[], box: MobileLayout, unit: number) {
  const lowest = Math.max(
    ...arms.flatMap((arm, i) =>
      arm.weights.map((w) => {
        const radius = Math.sqrt((w.mass * unit) / areaFactor(arm.shape));
        const extent = arm.shape === 'crystal' ? 2 : arm.shape === 'leaf' ? 1.4 : 1;
        return box.armYs[i] + w.position * box.half * Math.tan(arm.tilt) + extent * radius;
      }),
    ),
  );
  return arms.length ? Math.max(0, box.bottom - 60 - lowest) : 0;
}
interface SupportPoint {
  x: number;
  y: number;
  mass: number;
  top: number;
}
interface SupportRod extends SupportPoint {
  left: number;
  right: number;
  children: SupportPoint[];
  moment: number;
  tilt: number;
}
/** Subtree mass hangs at each child's pivot. Fit the analytic rod envelope into
 * the canopy with one vertical scale, preserving every torque's sign and ratio. */
export function supportTree(box: MobileLayout, arms: readonly Arm[]) {
  const rods: SupportRod[] = [];
  const leafTops = arms.map((arm, i) => box.armYs[i] - box.half * Math.abs(Math.tan(arm.tilt)));
  const visit = (from: number, to: number): SupportPoint => {
    if (to - from === 1)
      return {
        x: box.centers[from],
        y: box.armYs[from],
        top: leafTops[from],
        mass: arms[from].mass,
      };
    const middle = Math.floor((from + to) / 2);
    const a = visit(from, middle),
      b = visit(middle, to);
    const x = (a.x + b.x) / 2;
    const mass = a.mass + b.mass;
    const half = (b.x - a.x) / 2;
    const moment = a.mass * (a.x - x) + b.mass * (b.x - x);
    const tilt = mass > 0 ? clamp(moment / (mass * half), -1, 1) * 0.19 : 0;
    const rise = (half + 7) * Math.abs(Math.tan(tilt));
    const y = Math.min(a.top, b.top) - 16 - rise;
    const node = {
      x,
      y,
      top: y - rise,
      mass,
      moment,
      tilt,
      left: a.x,
      right: b.x,
      children: [a, b],
    };
    rods.push(node);
    return node;
  };
  const root = arms.length
    ? visit(0, arms.length)
    : { x: box.centers[0], y: box.armYs[0], top: box.armYs[0], mass: 0 };
  const floor = Math.min(...(leafTops.length ? leafTops : box.armYs)) - 16;
  const top = Math.min(floor, ...rods.map((rod) => rod.top));
  const scale = top < box.top ? clamp((floor - box.top) / (floor - top)) : 1;
  for (const rod of rods) {
    rod.y = floor - (floor - rod.y) * scale;
    rod.top = floor - (floor - rod.top) * scale;
    rod.tilt = Math.atan(Math.tan(rod.tilt) * scale);
  }
  return { rods, root, scale };
}

/** Swing grows in open space, but its whole envelope stays in the note's bay
 * and below half the free distance between adjacent counted weights. */
export function swingReach(arm: Arm, weight: Weight, box: MobileLayout, radius: number) {
  const neighbour = Math.min(
    ...arm.weights
      .filter((w) => w !== weight)
      .map((w) => Math.abs(w.position - weight.position) * box.half),
  );
  return Math.max(
    0,
    Math.min(
      12,
      (box.bay / 2 - Math.abs(weight.position * box.half) - radius - 1) * 0.8,
      // The larger radii use 42% of a neighbour gap; reserve 7% for each swing.
      neighbour * 0.07,
    ),
  );
}
