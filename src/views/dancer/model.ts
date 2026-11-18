import type { ViewFrame, ViewNote } from '../types';
import { drumEvidence, lowestPitchedPart, mostRegularDrum, roleEvidence } from '../shared/roles';
import { noteProgress } from '../shared/timing';
import { clamp } from '../shared/math';
import { pitch } from '../shared/pitch';

export const roles = ['feet', 'head', 'hands', 'hips', 'arms', 'torso'] as const;
export type Role = (typeof roles)[number];
export interface DancerScore {
  notes: ViewNote[];
  parts: Map<string, Role[]>;
}
export function cutoff(note: ViewNote): number | undefined {
  const value = note.value.cutoff ?? note.value.lpf;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
export function pan(note: ViewNote): number | undefined {
  const value = note.value.pan;
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value) : undefined;
}
/** Timbral roles cannot be recovered from the score. Downbeat-led and sparse
 * short unpitched rhythms take feet; the other short rhythms take hands.
 * Neither document names nor sample names participate. */
export function indexDancer(source: ViewNote[]): DancerScore {
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
  const continuations = new Set<string>();
  // Whole-span query fragments repeat a voice, while coincident onsets are polyphony.
  const notes = source.filter((n) => {
    if (n.hasOnset) return true;
    const key = identity(n);
    if (onsets.has(key) || continuations.has(key)) return false;
    continuations.add(key);
    return true;
  });
  // Sample selectors also arrive as n. Only explicit notes/frequencies establish
  // pitched anatomy (the same distinction used by Harmonograph).
  const evidence = roleEvidence(notes.map((n) => ({ ...n, value: { ...n.value, n: undefined } })));
  const drums = [...evidence.values()].filter(
    (p) => !Number.isFinite(p.meanPitch) && p.duration <= 0.5 && p.hits.length >= 2,
  );
  const downbeat = Math.max(0, ...drums.map((p) => drumEvidence(p)?.downbeats ?? 0));
  const head = mostRegularDrum(evidence, 'regular', drums.map((p) => p.id).sort());
  const hips = lowestPitchedPart(evidence);
  const parts = new Map<string, Role[]>();
  for (const p of evidence.values()) {
    const assigned: Role[] = [];
    if (drums.includes(p)) {
      const feet =
        (downbeat > 0 && (drumEvidence(p)?.downbeats ?? 0) === downbeat) || p.density <= 1.5;
      assigned.push(feet ? 'feet' : 'hands');
    }
    if (p.id === head) assigned.push('head');
    if (p.id === hips) assigned.push('hips');
    parts.set(p.id, assigned);
  }
  return { notes, parts };
}
/** Stable note identity owns both its side and floor cell, independent of siblings. */
export function noteSeed(note: ViewNote): number {
  const key = `${note.instrument}|${String(pitch(note.value) ?? '')}|${String(note.start)}`;
  let seed = 2166136261;
  for (let i = 0; i < key.length; i++) seed = Math.imul(seed ^ key.charCodeAt(i), 16777619);
  return seed >>> 0;
}
const smooth = (p: number) => (p = clamp(p)) * p * (3 - 2 * p);
/** Zero position and velocity at both real note boundaries; a held target is
 * unchanged through the middle 76%. No historical note or synthetic tail. */
export function envelope(note: ViewNote, now: number): number {
  const p = noteProgress(note, now);
  return smooth(p / 0.12) * smooth((1 - p) / 0.12);
}
export interface DancerLayer {
  note: ViewNote;
  roles: Role[];
  side: number;
  cell: number;
  strength: number;
  progress: number;
  armTarget?: number;
}
export function poseAt(score: DancerScore, now: number, muted: ReadonlySet<string> = new Set()) {
  const layers: DancerLayer[] = [];
  const pose = { feet: [0, 0], hands: [0, 0], head: 0, hips: 0, arms: 0, torso: 0 };
  const counts = Object.fromEntries(roles.map((r) => [r, 0])) as Record<Role, number>;
  const tiles = new Map<number, DancerLayer[]>();
  for (const note of score.notes) {
    if (note.start > now || now >= note.end || muted.has(note.instrument)) continue;
    const assigned = [...(score.parts.get(note.instrument) ?? [])];
    const filter = cutoff(note),
      balance = pan(note);
    if (filter !== undefined) assigned.push('arms');
    if (balance !== undefined) assigned.push('torso');
    const seed = noteSeed(note),
      side = seed % 2;
    const progress = noteProgress(note, now),
      strength = envelope(note, now);
    const pulse = Math.sin(Math.PI * progress) ** 2 * strength;
    const armTarget =
      filter === undefined ? undefined : clamp(Math.log(filter / 60) / Math.log(16000 / 60));
    const layer = { note, roles: assigned, side, cell: seed % 24, strength, progress, armTarget };
    for (const role of assigned) {
      counts[role]++;
      if (role === 'feet' || role === 'hands') pose[role][side] += pulse;
      if (role === 'head') pose.head += pulse;
      if (role === 'hips') pose.hips += Math.sin(progress * Math.PI * 2) * strength;
      if (role === 'arms' && armTarget !== undefined) pose.arms += armTarget * strength;
      if (role === 'torso' && balance !== undefined) pose.torso += (balance * 2 - 1) * strength;
    }
    layers.push(layer);
    const tile = tiles.get(layer.cell) ?? [];
    tile.push(layer);
    tiles.set(layer.cell, tile);
  }
  // Contributions add, then bound the anatomy. Coincident contributions remain
  // present in layers, role counts and the counted floor cells even at saturation.
  pose.feet = pose.feet.map((n) => clamp(n));
  pose.hands = pose.hands.map((n) => clamp(n));
  pose.head = clamp(pose.head);
  pose.hips = clamp(pose.hips, -1, 1);
  pose.arms = clamp(pose.arms);
  pose.torso = clamp(pose.torso, -1, 1);
  return {
    pose,
    layers,
    counts,
    tiles,
    sounding: new Set(layers.map((l) => l.note.instrument)).size,
  };
}
export type DancerState = ReturnType<typeof poseAt>;

export function dancerLayout(width: number, height: number) {
  const compact = width < 800;
  const footer = compact ? 126 : 92;
  const top = 76,
    bottom = Math.max(top + 1, height - footer - 12);
  const scale = Math.max(0.01, Math.min((bottom - top) / 430, (width - 32) / 620));
  return {
    compact,
    footer,
    top,
    bottom,
    scale,
    x: width / 2,
    y: top + (bottom - top - 430 * scale) / 2,
  };
}
export function roleMembers(score: DancerScore, frame: ViewFrame, role: Role): string[] {
  return frame.instruments
    .filter(
      (i) =>
        (score.parts.get(i.id) ?? []).includes(role) ||
        score.notes.some(
          (n) =>
            n.instrument === i.id &&
            (role === 'arms' ? cutoff(n) !== undefined : role === 'torso' && pan(n) !== undefined),
        ),
    )
    .sort((a, b) => a.index - b.index)
    .map((i) => i.id);
}
