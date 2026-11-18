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
  const depth = Math.ceil(Math.log2(count));
  const canopy = Math.min((bottom - top) * 0.22, 90);
  const armY = top + canopy + (bottom - top - canopy) * 0.18;
  const half = Math.max(1, bay * 0.36);
  const stagger = Math.max(0, (bottom - armY - 65) * 0.12);
  const armYs = Array.from({ length: count }, (_, i) => armY + ((i % 3) - 1) * stagger);
  const room = Math.max(5, bottom - 65 - armY - stagger - half * 0.2);
  const hang = room * 0.3;
  const maxRadius = room * 0.15;
  return {
    bay,
    slots,
    footer,
    top,
    bottom,
    depth,
    canopy,
    armY,
    armYs,
    half,
    hang,
    maxRadius,
    centers: Array.from({ length: count }, (_, i) => 20 + (i + 0.5) * bay),
  };
}
export type MobileLayout = ReturnType<typeof mobileLayout>;
/** One area unit across every arm and every shape. Crowding reduces the common
 * scale, never clips gain or substitutes a minimum filled weight. */
export function areaUnit(arms: Arm[], box: MobileLayout) {
  let unit = 2400;
  for (const arm of arms) {
    for (const w of arm.weights) {
      if (!w.mass) continue;
      const neighbour = Math.min(
        ...arm.weights
          .filter((other) => other !== w)
          .map((other) => Math.abs(other.position - w.position) * box.half),
      );
      const radius = Math.min(box.maxRadius, Math.max(0.1, box.bay * 0.14 - 4), neighbour * 0.34);
      unit = Math.min(unit, (areaFactor(arm.shape) * radius * radius) / w.mass);
    }
  }
  return unit;
}
/** Binary support rods occupy only the canopy; leaf suspensions enter separate bays. */
export function supportTree(box: MobileLayout, arms: number) {
  const rods: {
    x: number;
    y: number;
    left: number;
    right: number;
    children: { x: number; y: number }[];
  }[] = [];
  const visit = (from: number, to: number, depth: number): { x: number; y: number } => {
    if (to - from === 1) return { x: box.centers[from], y: box.armYs[from] };
    const middle = Math.floor((from + to) / 2);
    const a = visit(from, middle, depth + 1),
      b = visit(middle, to, depth + 1);
    const node = {
      x: (a.x + b.x) / 2,
      y: box.top + (depth * box.canopy) / Math.max(1, box.depth),
      left: a.x,
      right: b.x,
      children: [a, b],
    };
    rods.push(node);
    return node;
  };
  const root = arms ? visit(0, arms, 0) : { x: box.centers[0], y: box.armYs[0] };
  return { rods, root };
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
      neighbour * 0.15,
    ),
  );
}
