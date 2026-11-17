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
    // A chord is one swing. Keep every voice in notes for its held span.
    const starts = new Set<number>();
    part.onsets = part.notes.filter((n) => {
      if (!n.hasOnset || starts.has(n.start)) return false;
      starts.add(n.start);
      return true;
    });
    const first = part.onsets.at(0);
    const cycle = Math.floor(first?.start ?? 0);
    const count = part.onsets.filter((n) => n.start >= cycle && n.start < cycle + 1).length;
    // Windows start on cycle boundaries. Counting the first occupied cycle keeps
    // uneven rhythms with a constant onset count per cycle in phase across windows.
    // Varying cycle counts still need an onset ordinal from outside this window.
    part.anchor = cycle * count;
  }
  return parts;
}
function returnEnd(note: ViewNote): number {
  return note.end > note.start ? note.end : note.start + 1 / 8;
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
  if (previous)
    return (
      side * EXTREME * (1 - noteProgress({ start: previous.start, end: returnEnd(previous) }, now))
    );
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
      const cycle = part.onsets.filter((n) => n.start >= bar && n.start < bar + 1);
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
          resting || !part.onsets.length
            ? ''
            : JSON.stringify([
                cycle.map((n) => n.start),
                previous?.start,
                next?.start,
                next || !previous ? null : returnEnd(previous),
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
export interface Slot {
  x: number;
  base: number;
  scale: number;
  width: number;
  nameSize: number;
  compact: boolean;
  top: number;
  bottom: number;
}
/** Foreground parts keep the mockup's scale; parked parts use a secondary band.
 * The card's 20-part crowd rule takes precedence over foreground sizing. */
export function layout(
  frame: Pick<ViewFrame, 'width' | 'height'>,
  count: number,
  moving = count,
  top = 76,
) {
  const available = Math.max(1, frame.height - top - 16);
  const columnsFor = (n: number) =>
    Math.min(Math.max(1, n), n > 16 ? 5 : n > 6 ? Math.ceil(n / 2) : frame.width < 700 ? 3 : 6);
  const split = moving > 0 && moving < count && count <= 16;
  const columns = columnsFor(split ? moving : count);
  const rows = Math.max(1, Math.ceil((split ? moving : count) / columns));
  const slots: Slot[] = [];
  const place = (
    start: number,
    length: number,
    cols: number,
    y: number,
    height: number,
    compact: boolean,
  ) => {
    const bandRows = Math.max(1, Math.ceil(length / cols));
    const cellWidth = (frame.width - 32) / cols;
    const cellHeight = height / bandRows;
    const labelSpace = compact ? 20 : 40;
    const nameSize = compact || count > 16 ? 12 : clamp((13 * frame.width) / 960, 12, 18);
    // The drawing extends 206 units above the pivot and 35 below it.
    const scale = Math.max(
      compact ? 0.1 : 0.02,
      Math.min(cellWidth / 146, (cellHeight - labelSpace - 8) / 241),
    );
    for (let i = 0; i < length; i++) {
      const markTop =
        y + Math.floor(i / cols) * cellHeight + (cellHeight - 241 * scale - labelSpace) / 2;
      slots[start + i] = {
        x: 16 + ((i % cols) + 0.5) * cellWidth,
        base: markTop + 206 * scale,
        scale,
        width: cellWidth,
        nameSize,
        compact,
        top: markTop,
        bottom: markTop + 241 * scale + labelSpace,
      };
    }
  };
  let parkedTop: number | undefined;
  if (split) {
    const parked = count - moving;
    const parkColumns = frame.width < 700 && frame.height >= 600 ? Math.min(4, parked) : parked;
    const parkRows = Math.ceil(parked / parkColumns);
    const requiredMain = rows * ((241 * frame.width) / 960 + 48);
    const parkHeight = Math.min(
      parkRows * 116,
      available * 0.3,
      Math.max(44, available - requiredMain - 2),
    );
    const mainHeight = available - parkHeight;
    parkedTop = top + mainHeight;
    place(0, moving, columns, top, mainHeight, false);
    place(moving, parked, parkColumns, parkedTop, parkHeight, true);
  } else place(0, count, columns, top, available, false);
  return { columns, rows, slots, parkedTop };
}
