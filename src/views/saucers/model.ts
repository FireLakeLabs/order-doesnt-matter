import type { ViewFrame, ViewNote } from '../types';
import { indexScore } from '../shared/retro-2d';
import { pitch } from '../shared/pitch';
import { clamp } from '../shared/math';
import { noteProgress } from '../shared/timing';
import { random } from '../shared/particles';

export interface BeamNote {
  note: ViewNote;
  midi: number | undefined;
  seed: number;
}
/** Fold setting fragments into their whole span, retaining true unison onsets. */
export function analyse(notes: ViewNote[]) {
  const parts = new Map<string, BeamNote[]>();
  for (const [id, events] of indexScore(notes)) {
    const identity = (n: ViewNote) => JSON.stringify([n.start, n.end, pitch(n.value), n.value.s]);
    const onsets = new Set(events.filter((e) => e.note.hasOnset).map((e) => identity(e.note)));
    const seen = new Set<string>();
    const prepared: BeamNote[] = [];
    for (const { note, pitch: midi } of events) {
      const key = identity(note);
      if (!note.hasOnset) {
        if (onsets.has(key) || seen.has(key)) continue;
        seen.add(key);
      }
      let seed = Math.round(note.start * 1e6);
      for (const char of id + key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
      prepared.push({ note, midi, seed });
    }
    parts.set(id, prepared);
  }
  return parts;
}
export const held = (note: ViewNote) => note.end - note.start > 1 / 8;
export function sectionAt(frame: Pick<ViewFrame, 'now' | 'sections'>) {
  const length = frame.sections.at(-1)?.to ?? 0;
  const offset = length > 0 ? Math.floor(frame.now / length) * length : 0;
  const section = frame.sections.find(
    (s) => s.from <= frame.now - offset && frame.now - offset < s.to,
  );
  if (!section) return { name: 'Open sky', presence: 1, arriving: false };
  const elapsed = frame.now - offset - section.from;
  const remaining = offset + section.to - frame.now;
  // Arrival/departure belong to section time, never an accumulated animation.
  return {
    name: section.name,
    presence: Math.min(clamp(elapsed / 0.5), clamp(remaining / 0.5)),
    arriving: elapsed < 0.5,
  };
}
export function formation(frame: ViewFrame, parts: ReturnType<typeof analyse>) {
  const instruments = [...frame.instruments].sort((a, b) => a.index - b.index);
  const columns = Math.min(5, Math.max(1, instruments.length));
  const rows = Math.ceil(instruments.length / columns);
  const squadron = instruments.length > 10;
  const size = clamp(
    Math.min((frame.width / columns) * 0.48, (frame.height / Math.max(1, rows)) * 0.45),
    44,
    112,
  );
  const ground = frame.height * 0.89;
  const ships = instruments.map((instrument, index) => {
    const events = parts.get(instrument.id) ?? [];
    const active = events.filter((e) => e.note.start <= frame.now && frame.now < e.note.end);
    const lit = instrument.inSection && !instrument.muted;
    const pitches = active.flatMap((e) => (e.midi === undefined ? [] : [e.midi]));
    const midi = pitches.length ? pitches.reduce((a, b) => a + b, 0) / pitches.length : undefined;
    const row = Math.floor(index / columns),
      col = index % columns;
    const rowCount = Math.min(columns, instruments.length - row * columns);
    const x = frame.width * (0.1 + (0.8 * (col + 0.5 + (columns - rowCount) / 2)) / columns);
    const baseY = frame.height * (rows === 1 ? 0.48 : 0.34 + (row / (rows - 1)) * 0.32);
    const altitude =
      midi === undefined ? 0 : ((clamp(midi, 24, 96) - 60) / 72) * frame.height * 0.2;
    const drift = instrument.inSection ? 0 : Math.sin(frame.now * 0.43 + instrument.index * 1.7);
    return {
      instrument,
      events,
      active,
      lit,
      size,
      squad: row,
      cargo: instrument.index % 3,
      x: x + (squadron && row % 2 ? (frame.width / columns) * 0.32 : 0) + drift * size * 0.08,
      padX: x + (row - (rows - 1) / 2) * Math.min(size * 0.75, (frame.width / columns) * 0.22),
      y:
        baseY -
        altitude +
        (squadron ? Math.abs(col - (rowCount - 1) / 2) * frame.height * 0.018 : 0) +
        drift * 5,
    };
  });
  return { ships, squadron, ground };
}
export type Ship = ReturnType<typeof formation>['ships'][number];
export function beamPose(event: BeamNote, ship: Ship, ground: number, now: number) {
  const progress = noteProgress(event.note, now);
  const offset = (random(event.seed) - 0.5) * ship.size * 0.45;
  const gain = event.note.value.gain;
  const width =
    ship.size *
    0.55 *
    Math.sqrt(clamp(typeof gain === 'number' && Number.isFinite(gain) ? gain : 1, 0, 2));
  return {
    x: ship.padX + offset + (ship.x - ship.padX - offset) * progress,
    groundX: ship.padX + offset,
    width,
    progress,
    y: ground - 12 - (ground - 12 - ship.y - ship.size * 0.25) * progress,
  };
}
export function motherships(frame: ViewFrame, ships: Ship[]) {
  const section = sectionAt(frame);
  return [...frame.rooms]
    .sort((a, b) => a.orbit - b.orbit)
    .map((room, index, rooms) => {
      const members = ships.filter((s) => room.members.includes(s.instrument.id));
      const size = Math.min(frame.width * 0.35, (frame.width / Math.max(1, rooms.length)) * 0.78);
      const x = frame.width * (rooms.length === 1 ? 0.72 : (index + 0.5) / rooms.length);
      const position = x + (1 - section.presence) * frame.width * 0.65;
      const y = Math.max(90, frame.height * 0.14);
      const ground = frame.height * 0.89;
      const reach = members.map((s) => {
        const u = Math.max(0.05, (s.y - y - 12) / (ground - y - 12));
        return {
          left: position + (s.x - s.size * 0.6 - position) / u,
          right: position + (s.x + s.size * 0.6 - position) / u,
        };
      });
      return {
        ...room,
        members,
        size,
        presence: section.presence,
        x: position,
        y,
        arriving: section.arriving,
        lightLeft: Math.min(position, ...reach.map((p) => p.left)),
        lightRight: Math.max(position, ...reach.map((p) => p.right)),
      };
    });
}
