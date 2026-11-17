import type { ViewFrame, ViewNote } from '../types';
import { pitch } from '../shared/pitch';
import { clamp } from '../shared/math';
import { flightProgress, noteProgress } from '../shared/timing';
import { random } from '../shared/particles';

export function seed(note: ViewNote) {
  let hash = Math.round(note.start * 1e6);
  const voice = note.value.note ?? note.value.n ?? note.value.s;
  const identity = typeof voice === 'string' || typeof voice === 'number' ? String(voice) : '';
  for (const char of `${note.instrument}:${String(note.end)}:${identity}`)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash;
}
export function enemySize(note: ViewNote) {
  const gain = note.value.gain;
  return (
    7 + 9 * Math.sqrt(clamp(typeof gain === 'number' && Number.isFinite(gain) ? gain : 1, 0, 2))
  );
}
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
export function formation(frame: ViewFrame) {
  const bar = Math.floor(frame.now);
  const left = Math.min(105, frame.width * 0.18),
    right = frame.width - 35;
  const top = 100,
    bottom = frame.height * 0.58;
  const visible = frame.instruments.filter(
    (i) =>
      i.inSection ||
      frame.notes.some((n) => n.instrument === i.id && n.end > bar && n.start < bar + 2),
  );
  const carriers = new Set(
    frame.notes
      .filter((n) => isCarrier(n) && n.end > bar && n.start < bar + 1)
      .map((n) => n.instrument),
  );
  visible.sort(
    (a, b) => Number(carriers.has(b.id)) - Number(carriers.has(a.id)) || a.index - b.index,
  );
  const spacing = Math.min(58, Math.max(10, (bottom - top) / Math.max(1, visible.length - 1)));
  const x = (time: number) => left + clamp(time - bar) * (right - left);
  const rows = visible.map((instrument, index) => {
    const notes = frame.notes.filter(
      (n) => n.instrument === instrument.id && n.end > bar && n.start < bar + 1,
    );
    const next = frame.notes.filter(
      (n) => n.instrument === instrument.id && n.start >= bar + 1 && n.start < bar + 2,
    );
    const currentEnemies = enemies(notes),
      nextEnemies = enemies(next);
    // Geometry, not a magic event cap: overlapping enemies or carriers become one counted shield.
    const overlaps = (events: ViewNote[], offset: number) => {
      const ordered = [...events].sort((a, b) => a.start - b.start);
      return ordered.some((n, i) => {
        if (i === 0) return false;
        const previous = ordered[i - 1];
        if (isCarrier(previous)) return n.start < previous.end;
        return (
          x(n.start - offset) - x(previous.start - offset) < enemySize(n) + enemySize(previous) + 6
        );
      });
    };
    const crowded = spacing < 22 || overlaps(currentEnemies, 0);
    const nextCrowded = spacing < 22 || overlaps(nextEnemies, 1);
    return {
      instrument,
      y: top + index * spacing,
      notes,
      next,
      enemies: currentEnemies,
      nextEnemies,
      crowded,
      nextCrowded,
    };
  });
  return { bar, left, right, x, shipX: x(frame.now), shipY: frame.height * 0.85, rows };
}
export function enemyPose(note: ViewNote, now: number, x: number, y: number, hitY: number) {
  const progress = flightProgress(note, now, 1 / 8);
  const diving = note.hasOnset && now < note.start && progress > 0;
  const u = diving ? Math.sqrt(progress) : 0;
  return {
    x: x + Math.sin(progress * Math.PI) * (random(seed(note)) - 0.5) * 55,
    y: y + (hitY - y) * u,
    diving,
    hit: note.hasOnset && now >= note.start,
    remaining: 1 - noteProgress(note, now),
  };
}
