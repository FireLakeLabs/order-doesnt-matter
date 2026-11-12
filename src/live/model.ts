import type { EventResult, SheetSoundState } from '../contract';
import type { Instrument, SongSection } from '../document';

export interface LiveInput {
  rows: Instrument[];
  sections: SongSection[];
  events: Record<string, EventResult>;
  sounds: SheetSoundState[];
  solo: string | null;
  /** Absolute cycles; null when stopped. The stopped view uses fromCycle. */
  playhead: number | null;
  fromCycle: number;
  toCycle: number;
}
export interface LiveInstrument {
  id: string;
  name: string;
  nameSource: 'author' | 'generated';
  /** Index in the sheet's row order. */
  colour: number;
  lastOnset: number | null;
  nextOnset: number | null;
  inSection: boolean;
  silenced: boolean;
  sound: 'ready' | 'loading' | 'missing' | 'not-loaded' | 'none';
  error: string | null;
  room: number | null;
}
export interface LiveRoom {
  orbit: number;
  members: string[];
  reverb: number | 'varies' | null;
  delay: number | 'varies' | null;
  /** Senders ask for different room size or delay time/feedback. */
  conflict: boolean;
}
export interface LiveModel {
  instruments: LiveInstrument[];
  rooms: LiveRoom[];
  cycle: number | null;
}
export interface TurnNote {
  instrument: string;
  cycle: number;
  from: number;
  to: number;
  label: string;
}
type Note = { cps: number; start: number; end: number; value: Record<string, unknown> };
type Part = { room: number | null; inSection: boolean; sends: Note[] };
type Indexed = { notes: Note[]; names: string[]; parts: Map<string, Part> };
const cache = new WeakMap<LiveInput['events'], Map<string, Indexed>>();
const bag = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : { value };
function indexed(input: LiveInput) {
  let found = cache.get(input.events);
  if (found) return found;
  found = new Map(
    Object.entries(input.events).map(([id, result]) => {
      const notes = (result.error ? [] : result.events)
        .filter((e) => e.whole && e.part[0] === e.whole[0])
        .map((e) => ({
          cps: result.cps,
          start: e.whole![0],
          end: e.whole![1],
          value: bag(e.value),
        }))
        .sort((a, b) => a.start - b.start);
      const names = [
        ...new Set(
          notes.flatMap((n) =>
            [n.value.s].flat().filter((s): s is string => typeof s === 'string'),
          ),
        ),
      ];
      return [id, { notes, names, parts: new Map() }];
    }),
  );
  cache.set(input.events, found);
  return found;
}
/** First note whose start is >= cycle (or > cycle for upper=true). */
function search(notes: Note[], cycle: number, upper = false) {
  let lo = 0,
    hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].start < cycle || (upper && notes[mid].start === cycle)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
// Pinned node_modules/superdough/superdough.mjs:195 defaults orbit to 1;
// line 485 uses it when absent. Only top-level sends are shared; FX bags stay private.
const orbit = (note: Note) => (typeof note.value.orbit === 'number' ? note.value.orbit : 1);
function participation(index: Indexed | undefined, from: number, to: number): Part {
  if (!index) return { room: null, inSection: false, sends: [] };
  const key = `${from}:${to}`;
  let part = index.parts.get(key);
  if (part) return part;
  const notes = index.notes.slice(search(index.notes, from), search(index.notes, to));
  const sends = notes.filter((n) => Number(n.value.room) > 0 || Number(n.value.delay) > 0);
  const counts = new Map<number, number>();
  for (const n of sends) counts.set(orbit(n), (counts.get(orbit(n)) ?? 0) + 1);
  const room = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  part = { room, inSection: !!notes.length, sends: sends.filter((n) => orbit(n) === room) };
  index.parts.set(key, part);
  return part;
}
const uniform = (values: unknown[]) => new Set(values).size <= 1;
function roomModel(orbit: number, members: string[], notes: Note[]): LiveRoom {
  const amount = (key: string): number | 'varies' | null => {
    const values = notes.map((n) => n.value[key] ?? 0);
    return uniform(values) ? (typeof values[0] === 'number' ? values[0] : null) : 'varies';
  };
  const reverbs = notes.filter((n) => Number(n.value.room) > 0);
  const delays = notes.filter((n) => Number(n.value.delay) > 0);
  return {
    orbit,
    members,
    reverb: amount('room'),
    delay: amount('delay'),
    conflict:
      !uniform(reverbs.map((n) => n.value.roomsize)) ||
      !uniform(
        delays.map((n) =>
          // Same pinned file:193–194 defaults feedback/sync; :503 converts
          // cycle delay to seconds only when explicit delaytime is absent.
          JSON.stringify([
            n.value.delaytime ?? Number(n.value.delaysync ?? 3 / 16) / n.cps,
            n.value.delayfeedback ?? 0.5,
          ]),
        ),
      ),
  };
}
// Section aggregates (including rooms) are computed once per events identity and
// absolute section, rather than scanning event values on every animation frame.
const aggregates = new WeakMap<
  LiveInput['events'],
  Map<string, { parts: Map<string, Part>; rooms: LiveRoom[] }>
>();
export function liveModel(input: LiveInput): LiveModel {
  const cycle = input.playhead ?? input.fromCycle;
  const last = input.sections.at(-1),
    length = last ? last.start + last.cycles : 0;
  const offset = length ? Math.floor(cycle / length) * length : 0;
  const section = input.sections.find(
    (s) => cycle - offset >= s.start && cycle - offset < s.start + s.cycles,
  );
  const from = section ? offset + section.start : input.fromCycle;
  const to = section ? from + section.cycles : input.toCycle;
  const indices = indexed(input);
  let windows = aggregates.get(input.events);
  if (!windows) aggregates.set(input.events, (windows = new Map()));
  const key = `${from}:${to}`;
  let aggregate = windows.get(key);
  if (!aggregate) {
    const parts = new Map([...indices].map(([id, index]) => [id, participation(index, from, to)]));
    const groups = new Map<number, { members: string[]; notes: Note[] }>();
    for (const [id, part] of parts)
      if (part.room !== null) {
        const group = groups.get(part.room) ?? { members: [], notes: [] };
        group.members.push(id);
        group.notes.push(...part.sends);
        groups.set(part.room, group);
      }
    aggregate = {
      parts,
      rooms: [...groups]
        .sort((a, b) => a[0] - b[0])
        .map(([orbit, g]) => roomModel(orbit, g.members, g.notes)),
    };
    windows.set(key, aggregate);
  }
  const sounds = new Map(input.sounds.map((s) => [s.name, s.state]));
  const priorities = ['missing', 'loading', 'not-loaded', 'ready'] as const;
  return {
    cycle: input.playhead,
    rooms: aggregate.rooms,
    instruments: input.rows.map((row, colour) => {
      const index = indices.get(row.id),
        notes = index?.notes ?? [];
      const at = search(notes, cycle, true),
        part = aggregate.parts.get(row.id);
      const states =
        index?.names.map((s) => sounds.get(s) ?? sounds.get(s.split(':')[0]) ?? 'not-loaded') ?? [];
      return {
        id: row.id,
        name: row.name.replaceAll('$', ''),
        nameSource: row.nameSource,
        colour,
        lastOnset: notes[at - 1]?.start ?? null,
        nextOnset: notes[at]?.start ?? null,
        inSection: part?.inSection ?? false,
        silenced:
          row.muted || !!row.pattern.muted || (input.solo !== null && input.solo !== row.id),
        sound: priorities.find((s) => states.includes(s)) ?? 'none',
        error: input.events[row.id]?.error?.message ?? null,
        room: part?.room ?? null,
      };
    }),
  };
}
/** Whole spans starting in [fromCycle, toCycle); tails can exceed one turn. */
export function turnNotes(input: LiveInput, fromCycle: number, toCycle: number): TurnNote[] {
  const indices = indexed(input);
  return input.rows.flatMap((row) => {
    const notes = indices.get(row.id)?.notes ?? [];
    return notes.slice(search(notes, fromCycle), search(notes, toCycle)).map((n) => {
      const cycle = Math.floor(n.start);
      return {
        instrument: row.id,
        cycle,
        from: n.start - cycle,
        to: n.end - cycle,
        label: String(n.value.note ?? n.value.s ?? n.value.n ?? n.value.value ?? 'note').replaceAll(
          '$',
          '',
        ),
      };
    });
  });
}
