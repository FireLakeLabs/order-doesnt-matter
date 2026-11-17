import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { indexScore } from '../shared/retro-2d';
import { pitch, pitchClass } from '../shared/pitch';
import { clamp } from '../shared/math';
import { flightProgress } from '../shared/timing';

export interface TubeEvent {
  note: ViewNote;
  rank: number;
  pitched: boolean;
  seed: number;
}
export interface Part {
  events: TubeEvent[];
}
export function analyse(notes: ViewNote[]): Map<string, Part> {
  const result = new Map<string, Part>();
  for (const [id, events] of indexScore(notes)) {
    events.sort((a, b) => a.note.start - b.note.start || a.note.end - b.note.end);
    const key = (n: ViewNote) => JSON.stringify([n.start, n.end, pitch(n.value), n.value.s]);
    const onsets = new Set(events.filter((e) => e.note.hasOnset).map((e) => key(e.note)));
    const fragments = new Set<string>();
    const prepared: TubeEvent[] = [];
    for (const { note, pitch: midi } of events) {
      const identity = key(note);
      if (!note.hasOnset) {
        if (onsets.has(identity) || fragments.has(identity)) continue;
        fragments.add(identity);
      }
      let seed = Math.round(note.start * 1e6);
      for (const char of id + identity) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
      // Address unpitched lanes from the note itself, never from a query-prefix
      // counter. Equal subdivisions cycle in order; sparse whole-cycle notes
      // advance on each cycle too. Whole spans also survive as fragments.
      const cycle = Math.floor(note.start);
      const rank =
        cycle + Math.floor((note.start - cycle) / Math.max(1e-9, note.end - note.start) + 1e-7);
      prepared.push({
        note,
        rank: midi === undefined ? rank : pitchClass(midi),
        pitched: midi !== undefined,
        seed,
      });
    }
    result.set(id, { events: prepared });
  }
  return result;
}
export function sectionAt(frame: Pick<ViewFrame, 'now' | 'sections'>) {
  const length = frame.sections.at(-1)?.to ?? 0;
  const local = length > 0 ? ((frame.now % length) + length) % length : frame.now;
  const index = frame.sections.findIndex((s) => s.from <= local && local < s.to);
  const nextIndex = index < 0 ? -1 : (index + 1) % frame.sections.length;
  const next = frame.sections[nextIndex];
  return {
    index: Math.max(0, index),
    name: frame.sections[index]?.name ?? 'Open tube',
    next:
      index >= 0 && nextIndex !== index
        ? {
            ...next,
            index: nextIndex,
            at: frame.now - local + next.from + (nextIndex === 0 ? length : 0),
          }
        : undefined,
  };
}
export interface Run {
  instrument: ViewInstrument;
  part: Part;
  start: number;
  count: number;
  logical: number;
}
/** Runs use only the document-ordered instrument inventory. Query windows,
 * section membership and event density may change brightness, never geometry. */
export function layout(frame: ViewFrame, parts: Map<string, Part>) {
  const instruments = [...frame.instruments].sort((a, b) => a.index - b.index);
  const count = instruments.length;
  const slots = Math.max(4, Math.ceil(8 / Math.max(1, count)));
  const logical = count * slots;
  const lanes = Math.max(8, Math.min(32, logical));
  const runs: Run[] = instruments.map((instrument, index) => {
    const start = Math.floor((index * lanes) / count);
    const end = Math.floor(((index + 1) * lanes) / count);
    return {
      instrument,
      part: parts.get(instrument.id) ?? { events: [] },
      start,
      count: Math.max(1, end - start),
      logical: slots,
    };
  });
  return { runs, lanes, logical, merged: logical > 32 };
}
export function laneFor(event: TubeEvent, run: Run) {
  const slot = event.pitched
    ? Math.floor((event.rank * run.count) / 12)
    : ((event.rank % run.count) + run.count) % run.count;
  return run.start + slot;
}
export const depth = (time: number, frame: Pick<ViewFrame, 'now' | 'lookAhead'>) =>
  1 - flightProgress({ start: time }, frame.now, frame.lookAhead);
export interface Geometry {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  lanes: number;
  shape: number;
}
export function geometry(
  frame: Pick<ViewFrame, 'width' | 'height'>,
  lanes: number,
  shape: number,
): Geometry {
  return {
    cx: frame.width / 2,
    cy: frame.height * 0.55,
    rx: frame.width * 0.42,
    ry: frame.height * 0.36,
    lanes,
    shape,
  };
}
export function tubePoint(g: Geometry, boundary: number, d: number) {
  const angle = -Math.PI / 2 + ((boundary - 0.5) * Math.PI * 2) / g.lanes;
  const mode = g.shape % 4;
  const phase = g.shape * 0.37;
  const radius =
    mode === 0
      ? 0.94 + 0.06 * Math.cos(2 * angle + phase)
      : mode === 1
        ? 0.88 + 0.12 * Math.cos(4 * angle + phase)
        : mode === 2
          ? 0.84 + 0.16 * Math.cos(5 * angle + phase)
          : 0.88 + 0.12 * Math.cos(3 * angle + 0.4 + phase);
  const scale = 1 / (1 + 4.5 * clamp(d));
  return {
    x: g.cx + Math.cos(angle) * g.rx * radius * scale,
    y: g.cy + Math.sin(angle) * g.ry * radius * scale,
  };
}
export function lanePoint(g: Geometry, lane: number, d: number) {
  const a = tubePoint(g, lane, d),
    b = tubePoint(g, lane + 1, d);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
export function enemyRadius(
  frame: Pick<ViewFrame, 'width' | 'height'>,
  d: number,
  merged: boolean,
) {
  return Math.max(
    2,
    clamp(Math.min(frame.width, frame.height) * 0.032, 14, 23) *
      (0.3 + 0.7 / (1 + 4.5 * d)) *
      (merged ? 0.65 : 1),
  );
}
/** All simultaneous targets get a claw tine, rather than choosing one chord note. */
export function latestTargets(frame: ViewFrame, runs: Run[]) {
  let latest = -Infinity;
  const targets = new Set<number>();
  for (const run of runs)
    if (!run.instrument.muted)
      for (const event of run.part.events) {
        if (!event.note.hasOnset || event.note.start > frame.now || event.note.start < latest)
          continue;
        if (event.note.start > latest) {
          latest = event.note.start;
          targets.clear();
        }
        targets.add(laneFor(event, run));
      }
  return [...targets];
}
