import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { clamp } from '../shared/math';
import { pitch } from '../shared/pitch';
import { lowestPitchedPart, mostRegularDrum, roleEvidence } from '../shared/roles';
import { noteProgress } from '../shared/timing';

export type Role = 'strobe' | 'wash' | 'heads';
interface Aim {
  start: number;
  from: number;
  to: number;
}
export interface Part {
  id: string;
  notes: ViewNote[];
  aims: Aim[];
}
export interface RigScore {
  parts: Map<string, Part>;
  evidence: ReturnType<typeof roleEvidence>;
}
/** Sample selection n is not pitch unless authored as a control. */
export function scoredPitch(note: ViewNote, instrument: ViewInstrument) {
  return note.value.note !== undefined ||
    note.value.freq !== undefined ||
    instrument.settings.some((s) => s.name === 'n')
    ? pitch(note.value)
    : undefined;
}
export const spread = (midi: number | undefined) =>
  midi === undefined ? 2.6 : 0.8 + 5.2 * clamp((midi - 24) / 72);
const smooth = (p: number) => p * p * (3 - 2 * p);
function aimAt(aim: Aim, now: number) {
  return (
    aim.from +
    (aim.to - aim.from) * smooth(noteProgress({ start: aim.start, end: aim.start + 0.12 }, now))
  );
}
export function indexRig(frame: Pick<ViewFrame, 'notes' | 'instruments'>): RigScore {
  const parts = new Map<string, Part>();
  const normalised: ViewNote[] = [];
  for (const instrument of frame.instruments) {
    const identity = (n: ViewNote) =>
      JSON.stringify([n.start, n.end, Object.entries(n.value).sort()]);
    const onsets = new Set(
      frame.notes.filter((n) => n.instrument === instrument.id && n.hasOnset).map(identity),
    );
    const seen = new Set<string>();
    const notes = frame.notes
      .filter((n) => n.instrument === instrument.id && n.end > n.start)
      .filter((n) => {
        // Repeated carry-in fragments describe one span; genuine coincident onsets stay counted.
        const key = identity(n);
        if (!n.hasOnset && (seen.has(key) || onsets.has(key))) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const aims: Aim[] = [];
    const starts = new Map<number, number[]>();
    for (const note of notes) {
      const midi = scoredPitch(note, instrument);
      const values = starts.get(note.start) ?? [];
      values.push(spread(midi));
      starts.set(note.start, values);
      // Feed the shared role chooser scored pitches, excluding sample-bank indices.
      const value = { ...note.value };
      delete value.n;
      if (midi !== undefined) value.note = midi;
      normalised.push({ ...note, value });
    }
    for (const [start, values] of starts) {
      const to = values.reduce((a, b) => a + b, 0) / values.length;
      aims.push({ start, from: aims.length ? aimAt(aims[aims.length - 1], start) : to, to });
    }
    parts.set(instrument.id, { id: instrument.id, notes, aims });
  }
  return { parts, evidence: roleEvidence(normalised) };
}
export function rigLook(frame: Pick<ViewFrame, 'now' | 'sections'>) {
  const length = frame.sections.at(-1)?.to ?? 0;
  const local = length > 0 ? ((frame.now % length) + length) % length : frame.now;
  const section = frame.sections.findIndex((s) => s.from <= local && local < s.to);
  return {
    index: Math.max(0, section),
    name: frame.sections[section]?.name ?? 'Open score',
    from: section >= 0 ? frame.now - local + frame.sections[section].from : -Infinity,
    to: section >= 0 ? frame.now - local + frame.sections[section].to : Infinity,
  };
}
export function rigSlots(frame: ViewFrame, score: RigScore) {
  const look = rigLook(frame);
  const members = frame.instruments
    .slice()
    .sort((a, b) => a.index - b.index)
    .filter(
      (i) =>
        !frame.sections.length ||
        i.inSection ||
        score.parts.get(i.id)?.notes.some((n) => n.start < look.to && n.end > look.from),
    );
  const ids = members.map((i) => i.id);
  const unpitched = ids.filter((id) => !Number.isFinite(score.evidence.get(id)?.meanPitch));
  const strobe = mostRegularDrum(score.evidence, 'regular', unpitched);
  const wash = lowestPitchedPart(score.evidence, new Set(ids));
  const other = members.filter((i) => i.id !== strobe && i.id !== wash);
  const capacity = 8 - Number(!!strobe) - Number(!!wash);
  const slots: { role: Role; members: ViewInstrument[] }[] = [];
  if (strobe) slots.push({ role: 'strobe', members: members.filter((i) => i.id === strobe) });
  if (wash) slots.push({ role: 'wash', members: members.filter((i) => i.id === wash) });
  for (let i = 0; i < Math.min(capacity, other.length); i++)
    slots.push({ role: 'heads', members: other.filter((_, j) => j % capacity === i) });
  return slots.map((slot) => {
    const targets = new Map<number, number[]>();
    for (const member of slot.members)
      for (const aim of score.parts.get(member.id)?.aims ?? []) {
        const values = targets.get(aim.start) ?? [];
        values.push(aim.to);
        targets.set(aim.start, values);
      }
    const aims: Aim[] = [];
    for (const [start, values] of [...targets].sort((a, b) => a[0] - b[0])) {
      const to = values.reduce((a, b) => a + b, 0) / values.length;
      aims.push({ start, from: aims.length ? aimAt(aims[aims.length - 1], start) : to, to });
    }
    return { ...slot, aims };
  });
}
export function partAt(part: Part, now: number, cps: number, role: Role) {
  const active = part.notes.filter((n) => n.start <= now && now < n.end);
  const seconds = Math.max(0.001, cps);
  const pulse = 0.035 * seconds;
  // One onset per fixed 320 ms bucket bounds dense strobe patterns without a clock.
  const bucket = 0.32 * seconds;
  const chosen = new Map<number, ViewNote>();
  if (role === 'strobe')
    for (const n of part.notes)
      if (n.hasOnset) {
        const key = Math.floor(n.start / bucket);
        if (!chosen.has(key)) chosen.set(key, n);
      }
  const flashes = active.filter(
    (n) =>
      n.hasOnset &&
      now - n.start < pulse &&
      (role !== 'strobe' || chosen.get(Math.floor(n.start / bucket)) === n),
  );
  const gain = (n: ViewNote) =>
    typeof n.value.gain === 'number' && Number.isFinite(n.value.gain)
      ? clamp(n.value.gain, 0, 4)
      : 1;
  const emitting = role === 'strobe' ? flashes : active;
  const brightness = emitting.reduce((sum, n) => sum + gain(n), 0);
  let aim = 2.6;
  for (const knot of part.aims) {
    if (knot.start > now) break;
    aim = aimAt(knot, now);
  }
  return {
    active: active.length,
    // Dense strobe hits merge into bounded pulses, with every reached onset counted.
    merged:
      role === 'strobe'
        ? part.notes.filter(
            (n) =>
              n.hasOnset &&
              n.start <= now &&
              Math.floor(n.start / bucket) === Math.floor(now / bucket),
          ).length
        : 0,
    flashing: flashes.length,
    held: role === 'strobe' ? 0 : active.length - flashes.length,
    brightness:
      role === 'strobe'
        ? Math.min(0.24, brightness * 0.24)
        : Math.min(1.4, brightness * (flashes.length ? 0.95 : 0.65)),
    aim,
  };
}
export function slotAt(
  slot: ReturnType<typeof rigSlots>[number],
  score: RigScore,
  frame: ViewFrame,
) {
  const states = slot.members.map((i) => ({
    instrument: i,
    state: partAt(
      score.parts.get(i.id) ?? { id: i.id, notes: [], aims: [] },
      frame.now,
      frame.cps,
      slot.role,
    ),
  }));
  // Colour ownership changes only on a new onset, never when a sibling ends.
  const latest = (id: string) => {
    let start = -Infinity;
    for (const note of score.parts.get(id)?.notes ?? [])
      if (note.start <= frame.now) start = Math.max(start, note.start);
    return start;
  };
  const leader =
    states
      .filter((s) => !s.instrument.muted)
      .sort(
        (a, b) =>
          latest(b.instrument.id) - latest(a.instrument.id) ||
          a.instrument.index - b.instrument.index,
      )[0] ?? states[0];
  let aim = 2.6;
  for (const knot of slot.aims) {
    if (knot.start > frame.now) break;
    aim = aimAt(knot, frame.now);
  }
  return {
    states,
    leader,
    aim,
    active: states.reduce((n, s) => n + (s.instrument.muted ? 0 : s.state.active), 0),
    merged: states.reduce((n, s) => n + (s.instrument.muted ? 0 : s.state.merged), 0),
    flashing: states.reduce((n, s) => n + (s.instrument.muted ? 0 : s.state.flashing), 0),
    held: states.reduce((n, s) => n + (s.instrument.muted ? 0 : s.state.held), 0),
    brightness: Math.min(
      slot.role === 'strobe' ? 0.24 : 1.4,
      states.reduce((n, s) => n + (s.instrument.muted ? 0 : s.state.brightness), 0),
    ),
  };
}
