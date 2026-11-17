import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { clamp } from '../shared/math';
import { nextOnset, noteProgress, previousOnset } from '../shared/timing';

export const EXTREME = Math.PI / 9;
export interface Part {
  notes: ViewNote[];
  onsets: ViewNote[];
  anchor: number;
}
export function analyse(notes: ViewNote[]) {
  const parts = new Map<string, Part>();
  for (const note of notes) {
    let part = parts.get(note.instrument);
    if (!part) parts.set(note.instrument, (part = { notes: [], onsets: [], anchor: 0 }));
    part.notes.push(note);
  }
  for (const part of parts.values()) {
    part.notes.sort((a, b) => a.start - b.start || a.end - b.end);
    // A chord is one swing, but every voice still counts towards density and hold.
    const starts = new Set<number>();
    part.onsets = part.notes.filter((n) => {
      if (!n.hasOnset || starts.has(n.start)) return false;
      starts.add(n.start);
      return true;
    });
    const first = part.onsets.at(0);
    const second = part.onsets.at(1);
    const gap = first && second ? second.start - first.start : 1;
    // Window frames cannot supply a lifetime onset ordinal. Anchor regular trains
    // to absolute time so moving the query window does not flip their polarity.
    part.anchor = first ? Math.round(first.start / (gap || 1)) : 0;
  }
  return parts;
}
export function swing(part: Part, now: number): number {
  const id = part.notes[0]?.instrument ?? '';
  const previous = previousOnset(part.onsets, id, now);
  const next = nextOnset(part.onsets, id, now);
  if (!previous && !next) return 0;
  const index = previous ? part.onsets.indexOf(previous) : -1;
  const side = (part.anchor + index) % 2 === 0 ? -1 : 1;
  if (previous && next) {
    const progress = noteProgress({ start: previous.start, end: next.start }, now);
    return side * EXTREME * Math.cos(progress * Math.PI);
  }
  // At the edge of available evidence ease out of / into the parked position,
  // rather than inventing another onset outside the score window.
  if (previous) return side * EXTREME * (1 - noteProgress(previous, now));
  return next ? -side * EXTREME * clamp(1 - (next.start - now)) : 0;
}
export interface Pose {
  instrument: ViewInstrument;
  part: Part;
  angle: number;
  held: boolean;
  lit: [number, number] | undefined;
  resting: boolean;
  hits: number;
  weight: number;
  fan: boolean;
  signature: string;
}
export function poses(frame: ViewFrame, parts: Map<string, Part>): Pose[] {
  const bar = Math.floor(frame.now);
  return [...frame.instruments]
    .sort((a, b) => a.index - b.index)
    .map((instrument) => {
      const part = parts.get(instrument.id) ?? { notes: [], onsets: [], anchor: 0 };
      const cycle = part.notes.filter((n) => n.hasOnset && n.start >= bar && n.start < bar + 1);
      const held = part.notes.filter((n) => n.start <= frame.now && frame.now < n.end);
      const resting = !cycle.length && !held.length;
      const angle = resting ? 0 : swing(part, frame.now);
      let lit: [number, number] | undefined;
      for (const note of held) {
        const turns = part.onsets.filter((n) => n.start >= note.start && n.start <= frame.now);
        const angles = [swing(part, note.start), angle];
        if (turns.length > 1) angles.push(-EXTREME, EXTREME);
        else if (turns.length) {
          const index = part.onsets.indexOf(turns[0]);
          angles.push((part.anchor + index) % 2 === 0 ? -EXTREME : EXTREME);
        }
        const lo = Math.min(...angles),
          hi = Math.max(...angles);
        lit = [Math.min(lit?.[0] ?? lo, lo), Math.max(lit?.[1] ?? hi, hi)];
      }
      const previous = previousOnset(part.onsets, instrument.id, frame.now);
      const next = nextOnset(part.onsets, instrument.id, frame.now);
      const side = previous ? (part.anchor + part.onsets.indexOf(previous)) % 2 : 0;
      return {
        instrument,
        part,
        angle,
        held: !!held.length,
        lit,
        resting,
        hits: cycle.length,
        weight: 0.9 - 0.55 * clamp(Math.log2(Math.max(1, cycle.length)) / 5),
        fan: cycle.length > 32,
        // Matching current-bar onset trains plus bracketing onsets and direction
        // identify a lock; crossing angles alone are only a momentary coincidence.
        signature:
          resting || !cycle.length
            ? ''
            : JSON.stringify([
                [...new Set(cycle.map((n) => n.start))],
                previous?.start,
                next?.start,
                side,
              ]),
      };
    });
}
export function inStep(cast: Pose[]): Pose[][] {
  const groups = new Map<string, Pose[]>();
  for (const pose of cast) {
    if (!pose.signature || pose.instrument.muted) continue;
    const group = groups.get(pose.signature) ?? [];
    group.push(pose);
    groups.set(pose.signature, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}
export function layout(frame: Pick<ViewFrame, 'width' | 'height'>, count: number) {
  const columns = Math.min(
    Math.max(1, count),
    count > 16 ? 5 : count > 6 ? Math.ceil(count / 2) : frame.width < 700 ? 3 : 6,
  );
  const rows = Math.max(1, Math.ceil(count / columns));
  const top = 100,
    bottom = 38;
  const cellWidth = (frame.width - 32) / columns;
  const cellHeight = Math.max(1, (frame.height - top - bottom) / rows);
  return { columns, rows, cellWidth, cellHeight, top };
}
