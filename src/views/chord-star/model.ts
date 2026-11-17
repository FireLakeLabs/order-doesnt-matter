import type { ViewFrame, ViewNote } from '../types';
import { chordName, pitch, pitchClass } from '../shared/pitch';
import { clamp } from '../shared/math';

export const fifths = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const names = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const className = (pc: number) => names[pc];
export const position = (pc: number) => (fifths.indexOf(pc) / 12) * Math.PI * 2 - Math.PI / 2;
export const spelling = (midi: number) =>
  `${className(pitchClass(midi))}${String(Math.floor(Math.round(midi) / 12) - 1)}`;

/** Strudel resolves n().scale() to note before ViewFrame; bare n is a sample index.
 * The shared legacy reader accepts bare n as MIDI, so narrow it locally here. */
export function readPitch(value: ViewNote['value']) {
  return pitch({ ...value, n: undefined });
}
export interface Point {
  instrument: string;
  pc: number;
  count: number;
  lowest: number;
}
export interface Chord {
  points: Point[];
  pitches: number[];
  classes: number[];
  lowest: number | undefined;
  name: string;
  root?: string;
  quality?: string;
  key: string;
}
const qualities: Record<string, string> = {
  '': 'major',
  m: 'minor',
  dim: 'diminished',
  '7': 'dominant 7',
  maj7: 'major 7',
  m7: 'minor 7',
  mMaj7: 'minor major 7',
  m7b5: 'half diminished 7',
};
function chord(notes: Iterable<{ note: ViewNote; midi: number }>): Chord {
  const groups = new Map<string, Point>();
  const pitches = new Set<number>();
  let lowest: number | undefined;
  for (const { note, midi } of notes) {
    const pc = pitchClass(midi),
      key = `${note.instrument}:${String(pc)}`;
    pitches.add(midi);
    lowest = Math.min(lowest ?? Infinity, midi);
    const point = groups.get(key);
    if (point) {
      point.count++;
      point.lowest = Math.min(point.lowest, midi);
    } else groups.set(key, { instrument: note.instrument, pc, count: 1, lowest: midi });
  }
  const sorted = [...pitches].sort((a, b) => a - b);
  const classes = fifths.filter((pc) => sorted.some((p) => pitchClass(p) === pc));
  const named = chordName(sorted);
  const match = named && /^([A-G]#?)(.*)$/.exec(named);
  const rootPitch = match ? pitch({ note: match[1] }) : undefined;
  const root = rootPitch === undefined ? undefined : className(pitchClass(rootPitch));
  const quality = match ? qualities[match[2]] : undefined;
  return {
    points: [...groups.values()].sort(
      (a, b) => a.pc - b.pc || a.instrument.localeCompare(b.instrument),
    ),
    pitches: sorted,
    classes,
    lowest,
    root,
    quality,
    name:
      root && quality !== undefined
        ? `${root} ${quality}`
        : classes.map(className).join(' · ') || 'No pitched notes',
    key: `${classes.join(',')}:${named ?? 'notes'}`,
  };
}
export interface Segment {
  from: number;
  to: number;
  chord: Chord;
}
export interface Score {
  segments: Segment[];
  unpitched: Set<string>;
  pitched: Set<string>;
}
/** Sweep exact scored starts/ends, including fragments; no assumed rhythmic grid. */
export function analyse(notes: readonly ViewNote[], muted = new Set<string>()): Score {
  const boundaries = new Map<number, { add: number[]; remove: number[] }>();
  const pitched = new Set<string>(),
    unpitched = new Set<string>();
  const events: { note: ViewNote; midi: number }[] = [];
  const edge = (time: number) => {
    let result = boundaries.get(time);
    if (!result) boundaries.set(time, (result = { add: [], remove: [] }));
    return result;
  };
  for (const note of notes) {
    const midi = readPitch(note.value);
    if (midi === undefined) {
      unpitched.add(note.instrument);
      continue;
    }
    pitched.add(note.instrument);
    if (muted.has(note.instrument) || note.end <= note.start) continue;
    const index = events.push({ note, midi }) - 1;
    edge(note.start).add.push(index);
    edge(note.end).remove.push(index);
  }
  const times = [...boundaries.entries()].sort((a, b) => a[0] - b[0]);
  const active = new Set<number>(),
    segments: Segment[] = [];
  for (const [i, [time, boundary]] of times.entries()) {
    for (const id of boundary.remove) active.delete(id);
    for (const id of boundary.add) active.add(id);
    if (i + 1 < times.length)
      segments.push({
        from: time,
        to: times[i + 1][0],
        chord: chord([...active].map((id) => events[id])),
      });
  }
  return { segments, unpitched, pitched };
}
const empty = chord([]);
/** The longest total occupancy of one simultaneous pitch set wins; ties use earliest occurrence. */
export function barChord(score: Score, bar: number, from: number, to: number) {
  if (bar < from || bar + 1 > to) return undefined;
  const durations = new Map<string, { chord: Chord; duration: number }>();
  for (const segment of score.segments) {
    const duration = Math.min(bar + 1, segment.to) - Math.max(bar, segment.from);
    if (duration <= 0 || !segment.chord.pitches.length) continue;
    const entry = durations.get(segment.chord.key);
    if (entry) entry.duration += duration;
    else durations.set(segment.chord.key, { chord: segment.chord, duration });
  }
  let best: { chord: Chord; duration: number } | undefined;
  for (const entry of durations.values()) if (!best || entry.duration > best.duration) best = entry;
  return best?.chord ?? empty;
}
export function at(frame: ViewFrame, score: Score) {
  const { now, from, to } = frame;
  const index = score.segments.findIndex((s) => s.from <= now && now < s.to);
  const current = index < 0 ? empty : score.segments[index].chord;
  let previous: Segment | undefined, next: Segment | undefined;
  for (const segment of score.segments) {
    if (!segment.chord.pitches.length || segment.chord.key === current.key) continue;
    if (segment.to <= now && segment.to > from) previous = segment;
    if (segment.from > now && segment.from < Math.min(to, now + frame.lookAhead)) {
      next = segment;
      break;
    }
  }
  const fade =
    previous && frame.trails
      ? clamp(1 - (now - previous.to) / (frame.trails === 2 ? 4 : 2)) * 0.45
      : 0;
  const bar = Math.floor(now);
  return {
    current,
    previous,
    next,
    fade,
    bars: Array.from({ length: 4 }, (_, i) => ({
      bar: Math.max(0, bar - 1) + i,
      chord: barChord(score, Math.max(0, bar - 1) + i, from, to),
    })),
  };
}
