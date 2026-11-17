import type { ViewFrame, ViewInstrument, ViewNote } from '../types';

import { clamp } from '../shared/math';
import { pitch as readPitch } from '../shared/pitch';
export { clamp } from '../shared/math';

// Rain historically accepts only numeric frequencies.
export const pitch = (value: ViewNote['value']) => readPitch(value, true);

export interface RainEvent {
  note: ViewNote;
  pitch: number | undefined;
}
export function indexNotes(notes: ViewNote[]): Map<string, RainEvent[]> {
  const groups = new Map<string, RainEvent[]>();
  for (const note of notes) {
    let group = groups.get(note.instrument);
    if (!group) groups.set(note.instrument, (group = []));
    group.push({ note, pitch: pitch(note.value) });
  }
  return groups;
}

export interface Lane {
  instrument: ViewInstrument;
  events: RainEvent[];
  left: number;
  right: number;
  low: number;
  high: number;
}
/** Ground trails are visible too; keep their pitch coordinates until they fade. */
function visible(frame: ViewFrame, note: ViewNote) {
  return (
    (note.end > frame.now && note.start < frame.now + frame.lookAhead) ||
    (note.hasOnset &&
      frame.trails > 0 &&
      note.start <= frame.now &&
      frame.now - note.start < (frame.trails === 2 ? 1 : 0.25))
  );
}
export function lanes(frame: ViewFrame, groups = indexNotes(frame.notes)): Lane[] {
  const active = frame.instruments
    .filter((instrument) => groups.get(instrument.id)?.some(({ note }) => visible(frame, note)))
    .sort((a, b) => a.index - b.index);
  const width = frame.width * (active.length === 1 ? 1 / 3 : 0.9);
  return active.map((instrument, i) => {
    const events = groups.get(instrument.id) ?? [];
    // Pitch bounds belong to the visible marks, including ground trails.
    let low = Infinity;
    let high = -Infinity;
    for (const event of events) {
      if (event.pitch === undefined || !visible(frame, event.note)) continue;
      low = Math.min(low, event.pitch);
      high = Math.max(high, event.pitch);
    }
    return {
      instrument,
      events,
      left: (frame.width - width) / 2 + (i * width) / active.length,
      right: (frame.width - width) / 2 + ((i + 1) * width) / active.length,
      low,
      high,
    };
  });
}

export function roadScale(frame: Pick<ViewFrame, 'now' | 'lookAhead'>, cycle: number) {
  return 1 / (1 + (1 / 0.35 - 1) * clamp((cycle - frame.now) / frame.lookAhead));
}
export const roadY = (height: number, scale: number) =>
  height * (0.12 + (0.7 * (scale - 0.35)) / 0.65);

/** A pinhole road: distance in cycles is linear in depth, never in screen pixels. */
export function project(
  frame: Pick<ViewFrame, 'width' | 'height' | 'now' | 'lookAhead'>,
  x: number,
  cycle: number,
) {
  const scale = roadScale(frame, cycle);
  return {
    x: frame.width / 2 + (x - frame.width / 2) * scale,
    y: roadY(frame.height, scale),
    scale,
  };
}
export function notePosition(lane: Lane, event: RainEvent) {
  return event.pitch === undefined || lane.high <= lane.low
    ? 0.5
    : clamp((event.pitch - lane.low) / (lane.high - lane.low));
}
export function landing(
  note: ViewNote,
  now: number,
  cps: number,
  trails: 0 | 1 | 2,
  result = { held: false, flare: 0, ripple: -1, streak: 0 },
) {
  const age = now - note.start;
  const hit = note.hasOnset && age >= 0;
  result.held = hit && now < note.end;
  result.flare = hit ? clamp(1 - age / (0.12 * Math.max(cps, 0.001))) : 0;
  result.ripple = hit && trails > 0 && age < 0.25 ? age / 0.25 : -1;
  result.streak = hit && trails === 2 ? clamp(1 - age) : 0;
  return result;
}
