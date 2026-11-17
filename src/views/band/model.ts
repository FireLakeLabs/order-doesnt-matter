import type { ViewFrame, ViewInstrument, ViewNote } from '../types';

export type Body = 'heavy' | 'twitchy' | 'low' | 'jelly' | 'melody' | 'plain';
const dimensions: Record<Body, readonly [number, number]> = {
  heavy: [1.1, 0.94],
  twitchy: [0.62, 0.8],
  low: [1.48, 0.65],
  jelly: [1.03, 1.12],
  melody: [0.62, 1.42],
  plain: [0.88, 0.95],
};
export interface Part {
  notes: ViewNote[];
  body: Body;
  minPitch: number;
  maxPitch: number;
  ripple: number;
}
import { clamp } from '../shared/math';
export { clamp } from '../shared/math';
export function pitch(value: ViewNote['value']): number | undefined {
  const note = value.note ?? value.n;
  if (typeof note === 'number' && Number.isFinite(note)) return note;
  if (typeof note === 'string') {
    if (note.trim() && Number.isFinite(Number(note))) return Number(note);
    const match = /^([a-g])([#b]?)(-?\d+)?$/i.exec(note);
    if (match) {
      const semitone = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[match[1].toLowerCase()];
      return (
        (Number(match[3] || 3) + 1) * 12 +
        (semitone ?? 0) +
        (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0)
      );
    }
  }
  const freq = Number(value.freq);
  return freq > 0 && Number.isFinite(freq) ? 69 + 12 * Math.log2(freq / 440) : undefined;
}
const level = (note: ViewNote) => {
  const gain = Number(note.value.gain ?? 1);
  return Number.isFinite(gain) ? clamp(gain, 0, 4) : 1;
};
/** Analyse the supplied song, never the instrument's display name. */
export function analyse(notes: ViewNote[]): Map<string, Part> {
  const groups = new Map<string, ViewNote[]>();
  for (const note of notes) {
    const group = groups.get(note.instrument);
    if (group) group.push(note);
    else groups.set(note.instrument, [note]);
  }
  const parts = new Map<string, Part>();
  for (const [id, group] of groups) {
    group.sort((a, b) => a.start - b.start);
    const starts = group.filter((n) => n.hasOnset);
    const evidence = starts.length ? starts : group;
    const pitches = evidence.flatMap((n) => {
      const p = pitch(n.value);
      return p === undefined ? [] : [p];
    });
    const duration = evidence.reduce((sum, n) => sum + n.end - n.start, 0) / evidence.length;
    // Count occupied cycles rather than silence in other sections diluting density.
    const cycles = new Set(starts.map((n) => Math.floor(n.start))).size;
    const density = starts.length / Math.max(1, cycles);
    const movingSpans = new Map<string, { changes: number; duration: number }>();
    for (let i = 1; i < group.length; i++) {
      const a = group[i - 1],
        b = group[i];
      // Only fragments of the SAME held span establish motion within a note.
      if (b.hasOnset || a.start !== b.start || a.end !== b.end || pitch(a.value) !== pitch(b.value))
        continue;
      for (const key of ['lpf', 'cutoff', 'gain', 'pan']) {
        if (
          typeof a.value[key] === 'number' &&
          typeof b.value[key] === 'number' &&
          a.value[key] !== b.value[key]
        ) {
          const spanKey = `${String(b.start)}:${String(b.end)}:${String(pitch(b.value))}`;
          const span = movingSpans.get(spanKey) ?? { changes: 0, duration: b.end - b.start };
          span.changes++;
          movingSpans.set(spanKey, span);
          break;
        }
      }
    }
    let ripple = 0;
    for (const span of movingSpans.values())
      if (span.duration > 0) ripple = Math.max(ripple, span.changes / span.duration);
    const minPitch = pitches.length ? pitches.reduce((a, b) => Math.min(a, b)) : 48;
    const maxPitch = pitches.length ? pitches.reduce((a, b) => Math.max(a, b)) : 72;
    const body: Body =
      duration >= 0.4 && ripple > 0
        ? 'jelly'
        : duration >= 0.4 && pitches.length > 0 && minPitch < 40
          ? 'low'
          : pitches.length > 0
            ? 'melody'
            : duration <= 0.26
              ? density <= 4
                ? 'heavy'
                : 'twitchy'
              : 'plain';
    parts.set(id, {
      notes: group,
      body,
      minPitch,
      maxPitch,
      ripple,
    });
  }
  return parts;
}
export interface Pose {
  instrument: ViewInstrument;
  body: Body;
  x: number;
  y: number;
  width: number;
  height: number;
  floor: number;
  hop: number;
  mouth: number;
  blink: boolean;
  active: number;
  age: number;
  word: string;
  ripple: number;
  backstage: boolean;
  occupancy: number;
}
export function sectionAt(frame: ViewFrame, time: number) {
  const length = frame.sections.at(-1)?.to ?? 0;
  const offset = length > 0 ? Math.floor(time / length) * length : 0;
  const section = frame.sections.find((s) => time - offset >= s.from && time - offset < s.to);
  return section ? { ...section, from: section.from + offset, to: section.to + offset } : undefined;
}
function sectionMember(frame: ViewFrame, part: Part | undefined, time: number, fallback: boolean) {
  const section = sectionAt(frame, time);
  if (!section) return fallback;
  const length = frame.sections.at(-1)?.to ?? 0;
  // The song frame contains one iteration; its section membership also supplies
  // the entrance pose at the boundary with the previous iteration.
  const shift = length > 0 ? Math.floor((frame.from - section.from) / length) * length : 0;
  const from = section.from + shift + (section.to + shift <= frame.from ? length : 0);
  return (
    part?.notes.some(
      (n) => n.hasOnset && n.start >= from && n.start < from + section.to - section.from,
    ) ?? false
  );
}
function slots(frame: ViewFrame, parts: Map<string, Part>, time: number, current = false) {
  const ordered = [...frame.instruments].sort((a, b) => a.index - b.index);
  const stage = ordered.filter((i) =>
    current ? i.inSection : sectionMember(frame, parts.get(i.id), time, i.inSection),
  );
  const waiting = ordered.filter((i) => !stage.includes(i));
  const result = new Map<string, { x: number; y: number; size: number; backstage: boolean }>();
  for (const [list, backstage] of [
    [stage, false],
    [waiting, true],
  ] as const) {
    const rows = !backstage && list.length > 12 ? 2 : 1;
    const columns = Math.ceil(list.length / rows);
    for (const [i, instrument] of list.entries()) {
      const row = Math.floor(i / columns),
        column = i % columns;
      const count = Math.min(columns, list.length - row * columns);
      const peers = list.slice(row * columns, row * columns + count);
      const weights = peers.map((peer) =>
        backstage ? 1 : dimensions[parts.get(peer.id)?.body ?? 'plain'][0] * 1.4,
      );
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const preceding = weights.slice(0, column).reduce((sum, weight) => sum + weight, 0);
      result.set(instrument.id, {
        x:
          frame.width *
          (0.05 +
            ((preceding + weights[column] / 2) / total) * 0.9 +
            (rows === 2 ? (row === 0 ? -0.012 : 0.012) : 0)),
        y: frame.height * (backstage ? 0.925 : row === 0 && rows === 2 ? 0.49 : 0.72),
        size: backstage
          ? Math.min(frame.width * 0.045, frame.height * 0.05)
          : Math.min(
              frame.height * 0.19,
              (frame.width * 0.9) / total,
              (frame.width * 0.135) / dimensions[parts.get(instrument.id)?.body ?? 'plain'][0],
            ),
        backstage,
      });
    }
  }
  return result;
}
/** Absolute-time poses: calling with t, t+1, t gives exactly the same t. */
export function poses(frame: ViewFrame, parts: Map<string, Part>): Pose[] {
  const current = slots(frame, parts, frame.now, true);
  const section = sectionAt(frame, frame.now);
  const transition = section && section.from > 0 ? clamp((frame.now - section.from) / 0.3) : 1;
  const previous = transition < 1 && section ? slots(frame, parts, section.from - 0.001) : current;
  const ease = transition * transition * (3 - 2 * transition);
  return frame.instruments.map((instrument) => {
    const part = parts.get(instrument.id);
    const body = part?.body ?? 'plain';
    const slot = current.get(instrument.id);
    if (!slot) throw Error('Missing creature slot');
    const before = previous.get(instrument.id) ?? slot;
    let active = 0,
      occupancy = 0,
      latest: ViewNote | undefined;
    for (const note of part?.notes ?? []) {
      if (note.start <= frame.now && frame.now < note.end) {
        occupancy++;
        if (!instrument.muted && !slot.backstage) active += level(note);
        if (!latest || (note.hasOnset && (!latest.hasOnset || note.start > latest.start)))
          latest = note;
      }
    }
    const age = latest ? frame.now - latest.start : -1;
    const hit = latest?.hasOnset && active > 0 ? clamp(age / 0.0625) : 1;
    // A weighted landing then one spring overshoot, over one quarter beat.
    const squash =
      hit < 0.35
        ? -0.25 * Math.sin(((hit / 0.35) * Math.PI) / 2)
        : hit < 1
          ? (-0.25 * Math.cos(((hit - 0.35) / 0.65) * Math.PI * 1.5) * (1 - hit)) / 0.65
          : 0;
    const breath = 1 + Math.sin(frame.now * Math.PI + instrument.index * 1.7) * 0.025;
    const dims = slot.backstage ? [1.1, 0.8] : dimensions[body];
    const size = before.size + (slot.size - before.size) * ease;
    const p = latest ? pitch(latest.value) : undefined;
    const stretch =
      body === 'melody' && active && p !== undefined
        ? 1 +
          0.25 *
            clamp(
              (p - (part?.minPitch ?? p)) /
                Math.max(12, (part?.maxPitch ?? p) - (part?.minPitch ?? p)),
            )
        : 1;
    const scaleY = (1 + squash) * breath * stretch;
    const height = size * dims[1] * scaleY;
    const hop =
      body === 'twitchy' && latest?.hasOnset && active
        ? height * 0.3 * Math.sin(Math.PI * clamp(age / 0.125))
        : 0;
    const floor = before.y + (slot.y - before.y) * ease;
    const walking = slot.backstage !== before.backstage && transition < 1;
    const long = latest && latest.end - latest.start >= 0.4;
    const mouth =
      active && latest
        ? long
          ? 1
          : clamp(1 - age / Math.max(0.001, latest.end - latest.start), 0.12, 1)
        : 0;
    return {
      instrument,
      body,
      x: before.x + (slot.x - before.x) * ease,
      y: floor - hop - (walking ? Math.abs(Math.sin(transition * Math.PI * 5)) * size * 0.12 : 0),
      floor,
      width: (size * dims[0]) / scaleY,
      height,
      hop,
      mouth,
      active,
      age,
      blink: (((frame.now + instrument.index * 0.731) % 3.7) + 3.7) % 3.7 < 0.07,
      word:
        body === 'heavy'
          ? 'boom'
          : body === 'twitchy'
            ? 'tss'
            : body === 'low'
              ? 'mmmmm'
              : body === 'jelly'
                ? 'wob'
                : body === 'melody'
                  ? long
                    ? 'laa'
                    : 'la'
                  : 'pah',
      ripple: (part?.ripple ?? 0) * frame.now * Math.PI * 2,
      backstage: slot.backstage,
      occupancy,
    };
  });
}
export interface Bubble {
  x: number;
  y: number;
  width: number;
  height: number;
  pose: Pose;
}
export function bubbles(performers: Pose[], width: number, fontSize: number): Bubble[] {
  const placed: Bubble[] = [];
  for (const pose of performers.filter((p) => p.active > 0).sort((a, b) => b.active - a.active)) {
    const w = pose.word.length * fontSize * 0.75 + 24,
      h = fontSize + 18;
    const x = clamp(pose.x - w / 2, 8, width - w - 8);
    const y =
      pose.y -
      pose.height -
      h -
      18 -
      Math.sin(
        (pose.body === 'jelly' ? (pose.ripple / (Math.PI * 2)) % 1 : clamp(pose.age / 0.08)) *
          Math.PI,
      ) *
        8;
    const candidate = { x, y, width: w, height: h, pose };
    if (
      y > 70 &&
      !placed.some(
        (b) =>
          x < b.x + b.width + 8 && x + w + 8 > b.x && y < b.y + b.height + 8 && y + h + 8 > b.y,
      )
    )
      placed.push(candidate);
  }
  return placed;
}
