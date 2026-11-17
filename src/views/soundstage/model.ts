import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { clamp } from '../shared/math';
import { previousOnset } from '../shared/timing';

export type StageIndex = Map<string, ViewNote[]>;
/** Continuations share whole spans with their onset; keep coincident real voices. */
export function indexStage(notes: ViewNote[]): StageIndex {
  const key = (n: ViewNote) => JSON.stringify([n.instrument, n.start, n.end, n.value]);
  const starts = new Set(notes.filter((n) => n.hasOnset).map(key));
  const parts: StageIndex = new Map();
  for (const n of notes) {
    if (!n.hasOnset && starts.has(key(n))) continue;
    let part = parts.get(n.instrument);
    if (!part) parts.set(n.instrument, (part = []));
    part.push(n);
  }
  for (const part of parts.values()) part.sort((a, b) => a.start - b.start || a.end - b.end);
  return parts;
}
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export function constant(instrument: ViewInstrument, name: string): number | undefined {
  const setting = instrument.settings.find((s) => s.name === name && s.kind === 'constant');
  return finite(setting?.value) ? setting.value : undefined;
}
export interface Placement {
  pan: number;
  room: number;
  gain: number;
  orbit: number | null;
  unknown: boolean;
}
/** A present note owns its whole bag, including absent controls' defaults. */
export function placement(instrument: ViewInstrument, note?: ViewNote): Placement {
  let unknown = false;
  const read = (name: string, fallback: number) => {
    const value = note ? note.value[name] : constant(instrument, name);
    if (finite(value)) return value;
    if (value !== undefined || (!note && instrument.settings.some((s) => s.name === name)))
      unknown = true;
    return fallback;
  };
  const orbit = note
    ? note.value.orbit === undefined
      ? 1
      : finite(note.value.orbit)
        ? note.value.orbit
        : null
    : instrument.room;
  return {
    pan: clamp(read('pan', 0.5)),
    room: clamp(read('room', 0)),
    gain: clamp(read('gain', 1), 0, 2),
    orbit,
    unknown,
  };
}
export interface Mark {
  instruments: ViewInstrument[];
  samples: ViewNote[];
  positions: Placement[];
  pan: number;
  room: number;
  gain: number;
  orbit: number | null;
  held: boolean;
  count: number;
  unknown: boolean;
}
/** Read active voices, otherwise the latest note available in this window.
 * No future note supplies a position. Unseen patterns use labelled defaults. */
export function stageMarks(frame: ViewFrame, index: StageIndex): Mark[] {
  const marks: Mark[] = [];
  for (const instrument of [...frame.instruments].sort((a, b) => a.index - b.index)) {
    const notes = index.get(instrument.id) ?? [];
    const active = notes.filter((n) => n.start <= frame.now && n.end > frame.now);
    if (!instrument.inSection && !active.length) continue;
    const latest =
      previousOnset(notes, instrument.id, frame.now) ?? notes.findLast((n) => n.start <= frame.now);
    const samples = active.length
      ? active
      : latest
        ? notes.filter((n) => n.start === latest.start)
        : [];
    const groups = new Map<string, Mark>();
    for (const n of samples.length ? samples : [undefined]) {
      const p = placement(instrument, n);
      const key = JSON.stringify([p.pan, p.room, p.orbit]);
      let mark = groups.get(key);
      if (!mark) {
        mark = {
          instruments: [instrument],
          samples: [],
          positions: [],
          ...p,
          held: active.length > 0 && !instrument.muted,
          count: 0,
        };
        groups.set(key, mark);
      }
      if (n) {
        mark.samples.push(n);
        mark.count++;
      }
      mark.positions.push(p);
      mark.gain = Math.max(mark.gain, p.gain);
      mark.unknown ||= p.unknown;
    }
    marks.push(...groups.values());
  }
  // Many simultaneous placements become one counted range per instrument.
  // Every scored position remains in `positions` and is drawn at its true place.
  const capacity = frame.width < 700 ? 16 : 32;
  if (marks.length <= capacity) return marks;
  const grouped = new Map<string, Mark>();
  for (const mark of marks) {
    const id = mark.instruments[0].id;
    const previous = grouped.get(id);
    if (!previous)
      grouped.set(id, { ...mark, samples: [...mark.samples], positions: [...mark.positions] });
    else {
      previous.samples.push(...mark.samples);
      previous.positions.push(...mark.positions);
      previous.count += mark.count;
      previous.gain = Math.max(previous.gain, mark.gain);
      previous.unknown ||= mark.unknown;
      if (previous.orbit !== mark.orbit) previous.orbit = null;
    }
  }
  for (const m of grouped.values()) {
    m.pan = m.positions.reduce((sum, p) => sum + p.pan, 0) / m.positions.length;
    m.room = m.positions.reduce((sum, p) => sum + p.room, 0) / m.positions.length;
  }
  return [...grouped.values()];
}
export interface RoomRequest {
  instrument: ViewInstrument;
  size: number;
}
export interface Rug {
  orbit: number;
  marks: Mark[];
  requests: RoomRequest[];
}
export const settingText = (n: number) => String(Number(n.toFixed(2))).replace(/^0\./, '.');
/** Keep room captions clear of the stage axes. Every rug still draws. */
export function roomCaptions(rugs: readonly Rug[]): string[] {
  return rugs.slice(0, 2).map((rug, i) => {
    const request = rug.requests.length
      ? `size requested by ${rug.requests.map((r) => `${r.instrument.name} ${settingText(r.size)}`).join(' · ')}`
      : 'size not specified';
    const more = rugs.length - 2;
    return `room ${String(rug.orbit)} · ${request}${i === 1 && more > 0 ? ` · +${String(more)} more ${more === 1 ? 'rug' : 'rugs'}` : ''}`;
  });
}
/** Membership is the host's sampled room inventory. Requests name authors,
 * never claim to measure a shared room's winning or audible state. */
export function roomRugs(frame: ViewFrame, marks: Mark[]): Rug[] {
  return frame.rooms.flatMap((room) => {
    const members = marks.filter(
      (m) =>
        m.instruments.some((i) => room.members.includes(i.id)) &&
        m.positions.some((p) => p.orbit === room.orbit),
    );
    if (!members.length) return [];
    const requests: RoomRequest[] = [];
    const seen = new Set<string>();
    for (const mark of members)
      for (const instrument of mark.instruments) {
        if (!room.members.includes(instrument.id)) continue;
        const values = mark.samples.length
          ? mark.samples
              .filter((n) => placement(instrument, n).orbit === room.orbit)
              .map((n) => n.value.size ?? n.value.roomsize)
          : [constant(instrument, 'size') ?? constant(instrument, 'roomsize')];
        for (const size of values)
          if (finite(size)) {
            const key = `${instrument.id}:${String(size)}`;
            if (!seen.has(key)) {
              requests.push({ instrument, size });
              seen.add(key);
            }
          }
      }
    return [{ orbit: room.orbit, marks: members, requests }];
  });
}
