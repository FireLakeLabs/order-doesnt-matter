import type { ViewFrame, ViewNote } from '../types';
import { roleEvidence, lowestPitchedPart } from '../shared/roles';
import { pitch } from '../shared/pitch';
import { scoredNotes } from '../shared/scored-notes';
import { sectionAt } from '../shared/ring-model';
import { clamp } from '../shared/math';
import { random } from '../shared/particles';
import { accidentalStyle, spell } from '../chord-bridge/drawing';

export const readPitch = (n: ViewNote) => pitch({ ...n.value, n: undefined });
export interface Gate {
  start: number;
  end: number;
  notes: ViewNote[];
  x: number;
  low: number;
  high: number;
  label: string;
}
/** A fixed MIDI axis, never normalized to the notes currently in the window. */
export const pitchX = (midi: number) => 0.5 + Math.tanh((midi - 60) / 12) * 0.35;
function indexMountain(notes: ViewNote[]) {
  const evidence = roleEvidence(notes.map((n) => ({ ...n, value: { ...n.value, n: undefined } })));
  const melody = [...evidence.values()]
    .filter((p) => Number.isFinite(p.meanPitch))
    .sort((a, b) => b.meanPitch - a.meanPitch || a.id.localeCompare(b.id))[0]?.id;
  const terrain = lowestPitchedPart(evidence);
  const style = accidentalStyle(
    notes.flatMap((n) => {
      const p = readPitch(n);
      return p === undefined ? [] : [p];
    }),
  );
  const groups = new Map<number, ViewNote[]>();
  for (const n of notes)
    if (n.instrument === melody && readPitch(n) !== undefined) {
      const group = groups.get(n.start) ?? [];
      group.push(n);
      groups.set(n.start, group);
    }
  const gates: Gate[] = [...groups]
    .sort(([a], [b]) => a - b)
    .map(([start, notes]) => {
      const pitches = notes
        .flatMap((n) => {
          const p = readPitch(n);
          return p === undefined ? [] : [p];
        })
        .sort((a, b) => a - b);
      const xs = pitches.map(pitchX);
      const low = Math.min(...xs),
        high = Math.max(...xs);
      return {
        start,
        end: Math.max(...notes.map((n) => n.end)),
        notes,
        x: (low + high) / 2,
        low,
        high,
        label:
          pitches.length === 1
            ? spell(pitches[0], style)
            : `${spell(pitches[0], style)}…${spell(pitches[pitches.length - 1], style)} ×${String(notes.length)}`,
      };
    });
  return { melody, terrain, notes, gates, style };
}
export function indexSlalom(frame: ViewFrame) {
  const section = sectionAt(frame);
  const notes = scoredNotes(frame.notes);
  // Index each supplied mountain, including the approach to the next section.
  // A crossing span belongs to the mountain where it began, so it stays counted once.
  const mountains = new Map<number | undefined, ViewNote[]>();
  for (const note of notes) {
    const key = sectionAt({ ...frame, now: note.start })?.from;
    const group = mountains.get(key) ?? [];
    group.push(note);
    mountains.set(key, group);
  }
  const courses = [...mountains].map(([from, notes]) => ({ from, ...indexMountain(notes) }));
  const current = courses.find((course) => course.from === section?.from) ?? indexMountain([]);
  return {
    ...current,
    section,
    gates: courses.flatMap((course) => course.gates).sort((a, b) => a.start - b.start),
    gateNotes: courses.flatMap((course) => course.gates.flatMap((gate) => gate.notes)),
    terrainNotes: courses.flatMap((course) =>
      course.notes.filter((n) => n.instrument === course.terrain),
    ),
    sideNotes: courses.flatMap((course) =>
      course.notes.filter((n) => n.instrument !== course.melody || readPitch(n) === undefined),
    ),
  };
}
export type SlalomScore = ReturnType<typeof indexSlalom>;
/** Cubic easing has continuous velocity at both ends, hits every onset exactly,
 * and begins a carve by the midpoint when notes touch, avoiding a jump. */
export function routeAt(gates: readonly Gate[], now: number): number {
  if (!gates.length) return 0.5;
  let lo = 0,
    hi = gates.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (gates[mid].start <= now) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(0, lo - 1);
  const a = gates[i],
    b = gates.at(i + 1);
  if (now < a.start || !b) return a.x;
  const departure = Math.min(a.end, a.start + (b.start - a.start) * 0.5);
  const u = b.start > departure ? clamp((now - departure) / (b.start - departure)) : 0;
  return a.x + (b.x - a.x) * u * u * (3 - 2 * u);
}
/** A held corridor follows the carve after its fixed pitch entrance. This also
 * permits a continuous run when a held note touches the following note. */
export function corridorOffset(
  gates: readonly Gate[],
  entrance: Pick<Gate, 'low' | 'high'>,
  time: number,
) {
  const x = routeAt(gates, time);
  return x - clamp(x, entrance.low, entrance.high);
}
export function slalomLayout(frame: ViewFrame) {
  const top = 100,
    bottom = Math.max(top + 80, frame.height - 98);
  const span = clamp(frame.lookAhead / 2, 1, 4);
  const from = frame.now - span * 0.42,
    to = frame.now + span * 0.58;
  const left = frame.width * 0.13,
    width = frame.width * 0.74;
  return {
    top,
    bottom,
    from,
    to,
    left,
    width,
    x: (x: number) => left + x * width,
    y: (time: number) => top + ((time - from) / span) * (bottom - top),
  };
}
export type SlalomLayout = ReturnType<typeof slalomLayout>;
/** Keep a carried flag visible only as far as its remaining scored span permits. */
export function sideSpan(note: ViewNote, box: SlalomLayout) {
  const start = box.y(Math.max(note.start, box.from));
  const end = box.y(Math.min(note.end, box.to));
  return { start: note.start < box.from ? Math.min(end, start + 20) : start, end };
}
/** Nearby gate labels merge; each corridor retains its own geometry. The count retains all source notes.
 * Route knots remain unmerged, so bundling cannot change the exact timing. */
export function gateBundles(score: SlalomScore, box: SlalomLayout) {
  const groups: { gates: Gate[]; y: number; low: number; high: number; count: number }[] = [];
  for (const gate of score.gates) {
    if (gate.start >= box.to || gate.end <= box.from) continue;
    const y = box.y(Math.max(box.from, gate.start));
    const previous = groups.at(-1);
    if (previous && y - previous.y < 32) {
      previous.gates.push(gate);
      previous.count += gate.notes.length;
      previous.low = Math.min(previous.low, gate.low);
      previous.high = Math.max(previous.high, gate.high);
    } else
      groups.push({ gates: [gate], y, low: gate.low, high: gate.high, count: gate.notes.length });
  }
  return groups;
}
export function slalomState(score: SlalomScore, frame: ViewFrame) {
  const box = slalomLayout(frame);
  const visible = (notes: ViewNote[]) => notes.filter((n) => n.start < box.to && n.end > box.from);
  return {
    box,
    bundles: gateBundles(score, box),
    passed: score.gates.filter((g) => g.start >= Math.floor(frame.now) && g.start <= frame.now),
    next: score.gates.find((g) => g.start > frame.now),
    gates: visible(score.gateNotes),
    terrain: visible(score.terrainNotes),
    sides: visible(score.sideNotes),
    x: routeAt(score.gates, frame.now),
  };
}

/** Stable snow identities scroll with absolute score time, across window edges. */
export function snowSpecks(from: number, to: number) {
  const specks = [];
  for (let cycle = Math.floor(from); cycle < Math.ceil(to); cycle++)
    for (let i = 0; i < 36; i++) {
      const seed = cycle * 36 + i;
      specks.push({
        time: cycle + random(seed, 4),
        x: random(seed, 3),
        radius: 0.7 + random(seed, 5),
      });
    }
  return specks;
}
export function routeAngle(gates: readonly Gate[], box: SlalomLayout, time: number) {
  return Math.atan2(
    box.width * (routeAt(gates, time + 0.0001) - routeAt(gates, time - 0.0001)),
    ((box.bottom - box.top) / (box.to - box.from)) * 0.0002,
  );
}
/** Monotone downhill samples cannot fold into loops on tight carves. */
export function trackPoint(
  gates: readonly Gate[],
  box: SlalomLayout,
  time: number,
  offset: number,
): [number, number] {
  return [
    box.x(routeAt(gates, time)) + Math.cos(routeAngle(gates, box, time)) * offset,
    box.y(time),
  ];
}
export function gateRails(gates: readonly Gate[], gate: Gate, box: SlalomLayout, time: number) {
  const shift = box.width * corridorOffset(gates, gate, time);
  return [box.x(gate.low) - 23 + shift, box.x(gate.high) + 23 + shift];
}
