import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { roleEvidence } from '../shared/roles';
import { pitch } from '../shared/pitch';
import { clamp } from '../shared/math';
import { flightProgress } from '../shared/timing';

export interface TubeEvent {
  note: ViewNote;
  rank: number;
  pitched: boolean;
  seed: number;
}
export interface Part {
  slots: number;
  pitches: number[];
  events: TubeEvent[];
}
export function analyse(notes: ViewNote[]): Map<string, Part> {
  const result = new Map<string, Part>();
  for (const [id, evidence] of roleEvidence(notes)) {
    const pitches = [
      ...new Set(evidence.events.flatMap((e) => (e.pitch === undefined ? [] : [e.pitch]))),
    ].sort((a, b) => a - b);
    const key = (n: ViewNote) => JSON.stringify([n.start, n.end, pitch(n.value), n.value.s]);
    const onsets = new Set(evidence.hits.map((e) => key(e.note)));
    const fragments = new Set<string>();
    let ordinal = 0;
    const events: TubeEvent[] = [];
    for (const { note, pitch: midi } of evidence.events) {
      const identity = key(note);
      if (!note.hasOnset) {
        if (onsets.has(identity) || fragments.has(identity)) continue;
        fragments.add(identity);
      }
      let seed = Math.round(note.start * 1e6);
      for (const char of id + identity) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
      events.push({
        note,
        rank: midi === undefined ? ordinal : pitches.indexOf(midi),
        pitched: midi !== undefined,
        seed,
      });
      if (note.hasOnset && midi === undefined) ordinal++;
    }
    result.set(id, {
      pitches,
      slots: pitches.length ? Math.max(2, pitches.length) : evidence.density >= 4 ? 4 : 2,
      events,
    });
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
      index >= 0
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
/** Fair lane merging keeps each of up to 32 instruments its own contiguous run. */
export function layout(frame: ViewFrame, parts: Map<string, Part>) {
  const visible = frame.instruments.filter(
    (i) =>
      i.inSection ||
      parts
        .get(i.id)
        ?.events.some(({ note: n }) => n.end > frame.now && n.start <= frame.now + frame.lookAhead),
  );
  const runs: Run[] = visible.map((instrument) => {
    const part = parts.get(instrument.id) ?? { slots: 2, pitches: [], events: [] };
    const logical = Math.max(part.slots, Math.ceil(8 / Math.max(1, visible.length)));
    return { instrument, part, start: 0, count: logical, logical };
  });
  const logical = runs.reduce((sum, r) => sum + r.logical, 0);
  if (logical > 32 && runs.length <= 32) {
    for (const run of runs) run.count = 1;
    for (let spare = 32 - runs.length; spare > 0; spare--) {
      const target = runs
        .filter((r) => r.count < r.logical)
        .sort((a, b) => b.logical / (b.count + 1) - a.logical / (a.count + 1))[0];
      target.count++;
    }
  }
  let total = 0;
  for (const run of runs) {
    run.start = total;
    total += run.count;
  }
  const lanes = Math.max(8, Math.min(32, total));
  // Beyond 32 instruments, adjacent runs share display lanes; events remain explicit.
  if (runs.length > 32)
    for (const run of runs) {
      const end = Math.ceil(((run.start + run.count) * 32) / total);
      run.start = Math.floor((run.start * 32) / total);
      run.count = Math.max(1, end - run.start);
    }
  return { runs, lanes, logical, merged: logical > 32 };
}
export function laneFor(event: TubeEvent, run: Run) {
  const slot = event.pitched
    ? Math.floor((event.rank * run.count) / Math.max(1, run.part.pitches.length))
    : event.rank % run.count;
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
  const radius =
    mode === 0
      ? 1
      : mode === 1
        ? 0.88 + 0.12 * Math.cos(4 * angle)
        : mode === 2
          ? 0.84 + 0.16 * Math.cos(5 * angle)
          : 0.88 + 0.12 * Math.cos(3 * angle + 0.4);
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
