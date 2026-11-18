import type { ViewFrame, ViewNote } from '../types';
import { pitch } from '../shared/pitch';
import { clamp } from '../shared/math';
import { flightProgress, noteProgress, previousOnset, nextOnset } from '../shared/timing';
import { mostRegularDrum, roleEvidence } from '../shared/roles';
import { random } from '../shared/particles';

export function seed(note: ViewNote) {
  let hash = Math.round(note.start * 1e6);
  const voice = note.value.note ?? note.value.n ?? note.value.s;
  const identity = typeof voice === 'string' || typeof voice === 'number' ? String(voice) : '';
  for (const char of `${note.instrument}:${String(note.end)}:${identity}`)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash;
}
export function enemySize(note: ViewNote, width = 1300) {
  const gain = note.value.gain;
  const level = Math.sqrt(
    clamp(typeof gain === 'number' && Number.isFinite(gain) ? gain : 1, 0, 2),
  );
  return Math.max(9, (Math.max(22, (38 * width) / 1300) * (0.8 + 0.2 * level)) / 2);
}
export const playerWidth = (width: number) => Math.max(18, (42 * width) / 1300);
/** Longer than an eighth is a carrier; fragments/signals retain their span without a hit. */
export const isCarrier = (note: ViewNote) => !note.hasOnset || note.end - note.start > 1 / 8;
export function wave(frame: Pick<ViewFrame, 'now' | 'sections'>) {
  const length = frame.sections.at(-1)?.to ?? 0;
  const local = length > 0 ? ((frame.now % length) + length) % length : frame.now;
  const index = frame.sections.findIndex((s) => s.from <= local && local < s.to);
  return { number: index + 1 || 1, name: frame.sections[index]?.name ?? 'Open space' };
}
/** Current-bar score count, never an accumulated counter or an invented unseen history. */
export function hitCount(frame: Pick<ViewFrame, 'now' | 'notes' | 'instruments'>) {
  const muted = new Set(frame.instruments.filter((i) => i.muted).map((i) => i.id));
  return frame.notes.filter(
    (n) =>
      n.hasOnset &&
      n.start >= Math.floor(frame.now) &&
      n.start <= frame.now &&
      !muted.has(n.instrument),
  ).length;
}
/** Setting fragments sharing a whole span continue its carrier, not extra enemies.
 * Keep every true onset, including stacked unisons. */
export function enemies(notes: ViewNote[]) {
  const span = (n: ViewNote) => {
    const sound = n.value.s;
    return `${String(n.start)}:${String(n.end)}:${String(pitch(n.value))}:${typeof sound === 'string' ? sound : ''}`;
  };
  const starts = new Set(notes.filter((n) => n.hasOnset).map(span));
  const continuations = new Set<string>();
  return notes.filter((n) => {
    if (n.hasOnset) return true;
    const key = span(n);
    if (starts.has(key) || continuations.has(key)) return false;
    continuations.add(key);
    return true;
  });
}
const ease = (u: number) => u * u * (3 - 2 * u);
const phase = (time: number) => time - Math.floor(time);
/** An eighth bar at ordinary tempos, bounded to 250–400 ms at other tempos. */
export function diveDuration(cps: number) {
  const rate = Math.max(0.001, cps);
  return clamp(1 / 8 / rate, 0.25, 0.4) * rate;
}
export function drumPart(notes: ViewNote[]) {
  return mostRegularDrum(roleEvidence(notes));
}
/** Six percent expansion on the scored drum onset, eased back by its next onset. */
export function breathing(
  frame: Pick<ViewFrame, 'notes' | 'now'>,
  drum: string | null = drumPart(frame.notes) ?? null,
) {
  if (!drum) return 1;
  const previous = previousOnset(frame.notes, drum, frame.now);
  if (!previous) return 1;
  const next = nextOnset(frame.notes, drum, previous.start);
  const span = Math.min(1, next ? next.start - previous.start : 1 / 4);
  return 1 + 0.06 * (1 - ease(clamp((frame.now - previous.start) / span)));
}
/** Simultaneous short notes share a rendezvous. Timing chooses a place, never a playhead. */
export const hitX = (start: number, width: number) =>
  width * (0.24 + 0.52 * random(Math.round(start * 1e6), 7));
export function shipX(frame: Pick<ViewFrame, 'notes' | 'now' | 'width' | 'cps' | 'instruments'>) {
  const muted = new Set(frame.instruments.filter((i) => i.muted).map((i) => i.id));
  let before = -Infinity,
    after = Infinity;
  for (const n of frame.notes) {
    if (!n.hasOnset || isCarrier(n) || muted.has(n.instrument)) continue;
    if (n.start <= frame.now) before = Math.max(before, n.start);
    else after = Math.min(after, n.start);
  }
  const travel = Math.max(0.001, frame.cps) * 0.65;
  const centre = frame.width / 2;
  if (after - before <= travel) {
    return (
      hitX(before, frame.width) +
      (hitX(after, frame.width) - hitX(before, frame.width)) *
        ease(clamp((frame.now - before) / (after - before)))
    );
  }
  if (frame.now - before < travel / 2)
    return (
      hitX(before, frame.width) +
      (centre - hitX(before, frame.width)) * ease(clamp((frame.now - before) / (travel / 2)))
    );
  return (
    centre +
    (hitX(after, frame.width) - centre) * ease(clamp(1 - (after - frame.now) / (travel / 2)))
  );
}
export function formation(frame: ViewFrame, drum: string | null = drumPart(frame.notes) ?? null) {
  const bar = Math.floor(frame.now);
  const left = frame.width * 0.15,
    right = frame.width * 0.85;
  const top = Math.max(90, frame.height * 0.15),
    bottom = Math.max(top, frame.height * 0.45);
  const visible = frame.instruments.filter(
    (i) =>
      i.inSection ||
      frame.notes.some((n) => n.instrument === i.id && n.end > bar && n.start < bar + 2),
  );
  const carriers = new Set(
    frame.notes
      .filter((n) => isCarrier(n) && n.end > bar && n.start < bar + 2)
      .map((n) => n.instrument),
  );
  visible.sort(
    (a, b) => Number(carriers.has(b.id)) - Number(carriers.has(a.id)) || a.index - b.index,
  );
  const spacing = (bottom - top) / Math.max(1, visible.length - 1);
  const x = (time: number, now = frame.now) =>
    frame.width / 2 + (phase(time) - 0.5) * (right - left) * breathing({ ...frame, now }, drum);
  const rows = visible.map((instrument, index) => {
    const notes = frame.notes.filter(
      (n) => n.instrument === instrument.id && n.end > bar && n.start < bar + 1,
    );
    const next = frame.notes.filter(
      (n) => n.instrument === instrument.id && n.start >= bar + 1 && n.start < bar + 2,
    );
    const currentEnemies = enemies(notes),
      nextEnemies = enemies(next);
    const overlaps = (events: ViewNote[]) => {
      const ordered = [...events].sort((a, b) => a.start - b.start);
      return ordered.some(
        (n, i) =>
          i > 0 &&
          Math.abs(x(n.start) - x(ordered[i - 1].start)) <
            spriteRadius(n, frame.width, frame.height) +
              spriteRadius(ordered[i - 1], frame.width, frame.height) +
              6,
      );
    };
    const cramped =
      spacing < Math.max(14, ((28 * frame.width) / 1300) * Math.min(1, frame.height / 760));
    return {
      instrument,
      y: visible.length === 1 ? (top + bottom) / 2 : top + index * spacing,
      notes,
      next,
      enemies: currentEnemies,
      nextEnemies,
      crowded: cramped || overlaps(currentEnemies),
      nextCrowded: cramped || overlaps(nextEnemies),
      recent: enemies(
        frame.notes.filter(
          (n) =>
            n.instrument === instrument.id && n.end <= bar && frame.now - n.start < frame.cps * 0.3,
        ),
      ),
    };
  });
  return { bar, left, right, x, shipX: shipX(frame), shipY: frame.height * 0.88, rows };
}
export const spriteRadius = (note: ViewNote, width: number, height = 760) =>
  enemySize(note, width) * clamp(height / 760, 0.65, 1) * (isCarrier(note) ? 1.5 : 1);
export interface Point {
  x: number;
  y: number;
}
/** One loop from alternating top corners, followed by settling into the true slot. */
export function entryPoint(
  u: number,
  slot: Point,
  width: number,
  height: number,
  side: number,
): Point {
  u = clamp(u);
  const settle = ease(u),
    loop = Math.sin(Math.PI * u);
  return {
    x:
      (side < 0 ? width * 0.04 : width * 0.96) * (1 - settle) +
      slot.x * settle +
      side * Math.sin(u * Math.PI * 2) * width * 0.2 * loop,
    y:
      -35 * (1 - settle) + slot.y * settle + (1 - Math.cos(u * Math.PI * 2)) * height * 0.18 * loop,
  };
}
export function divePoint(u: number, slot: Point, hit: Point, width: number): Point {
  u = clamp(u);
  const progress = ease(u),
    curl = Math.sin(u * Math.PI * 2) * (1 - u);
  return {
    x: slot.x + (hit.x - slot.x) * progress + curl * width * 0.16,
    y: slot.y + (hit.y - slot.y) * progress - curl * width * 0.045,
  };
}
/** All flights and their heading are functions of the note and time, including across a bar line. */
export function enemyPose(
  note: ViewNote,
  frame: ViewFrame,
  rowY: number,
  x: (time: number, now?: number) => number,
) {
  const flagship = isCarrier(note);
  const duration = diveDuration(frame.cps),
    start = flagship ? note.start : note.start - duration;
  const arrival = flagship ? note.start + Math.min(duration, note.end - note.start) : note.start;
  const hit = {
    x: isCarrier(note)
      ? frame.width * (0.2 + 0.6 * clamp((rowY / frame.height - 0.15) / 0.3))
      : hitX(note.start, frame.width),
    y: frame.height * (isCarrier(note) ? 0.6 : 0.76),
  };
  const slot = { x: x(note.start, start), y: rowY };
  const entryStart = Math.floor(note.start) - 0.5;
  const entryEnd = Math.min(Math.floor(note.start), start);
  const position = (now: number): Point => {
    if (!note.hasOnset) return { x: x(note.start), y: rowY };
    if (now >= start)
      return divePoint(
        flagship
          ? clamp((now - start) / Math.max(0.001, arrival - start))
          : flightProgress(note, now, duration),
        slot,
        hit,
        frame.width,
      );
    if (now < entryEnd)
      return entryPoint(
        (now - entryStart) / (entryEnd - entryStart),
        { x: x(note.start, entryEnd), y: rowY },
        frame.width,
        frame.height,
        seed(note) % 2 ? -1 : 1,
      );
    return { x: x(note.start, now), y: rowY };
  };
  const point = position(frame.now),
    ahead = position(frame.now + 0.0001);
  const moving =
    note.hasOnset && frame.now < arrival && (frame.now >= start || frame.now < entryEnd);
  return {
    ...point,
    hitX: flagship ? slot.x : hit.x,
    hitY: flagship ? slot.y : hit.y,
    angle: moving ? Math.atan2(ahead.y - point.y, ahead.x - point.x) - Math.PI / 2 : 0,
    entering: frame.now >= entryStart && frame.now < entryEnd,
    visible: !note.hasOnset || frame.now >= entryStart,
    diving: note.hasOnset && frame.now >= start && frame.now < arrival,
    hit: note.hasOnset && frame.now >= note.start,
    remaining: 1 - noteProgress(note, frame.now),
  };
}
/** Two scrolling layers, no section resets or accumulated motion. */
export function starPoint(index: number, now: number, layer: number): Point {
  return {
    x: random(index, layer * 2),
    y: phase(random(index, layer * 2 + 1) + now * (layer ? 0.11 : 0.035)),
  };
}
