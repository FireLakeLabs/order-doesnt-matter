import type { ViewFrame, ViewInstrument, ViewNote } from '../types';

export const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));

/** MIDI coordinates, preserving the contract's precedence without guessing drum pitches. */
export function pitch(value: ViewNote['value']): number | undefined {
  const raw = value.note ?? value.n;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    if (raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
    const match = /^([a-g])([#b]?)(-?\d+)?$/i.exec(raw.trim());
    if (match) {
      const semitone = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[match[1].toLowerCase() as 'c'];
      return (
        (Number(match[3] || '3') + 1) * 12 +
        semitone +
        (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0)
      );
    }
  }
  const frequency = value.freq;
  if (typeof frequency === 'number' && frequency > 0 && Number.isFinite(frequency))
    return 69 + 12 * Math.log2(frequency / 440);
  return undefined;
}

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
export function lanes(frame: ViewFrame, groups = indexNotes(frame.notes)): Lane[] {
  const active = frame.instruments
    .filter((instrument) =>
      groups
        .get(instrument.id)
        ?.some(
          ({ note }) =>
            (note.end > frame.now && note.start < frame.now + frame.lookAhead) ||
            (note.hasOnset &&
              frame.trails > 0 &&
              note.start <= frame.now &&
              frame.now - note.start < (frame.trails === 2 ? 1 : 0.25)),
        ),
    )
    .sort((a, b) => a.index - b.index);
  const width = frame.width * (active.length === 1 ? 1 / 3 : 0.9);
  return active.map((instrument, i) => {
    const events = groups.get(instrument.id) ?? [];
    let low = Infinity;
    let high = -Infinity;
    for (const event of events) {
      if (
        event.pitch === undefined ||
        event.note.end <= frame.now ||
        event.note.start >= frame.now + frame.lookAhead
      )
        continue;
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
