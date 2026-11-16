import type { ViewFrame, ViewNote } from '../types';
import { clamp, indexScore, type Event } from '../shared/retro-2d';

export type Role = 'ground' | 'platform' | 'block' | 'crate' | 'coin';
export interface Part {
  id: string;
  events: Event[];
  hits: Event[];
  low: number;
  high: number;
  density: number;
  duration: number;
  regularity: number;
  phase: number;
  meanPitch: number;
  role: Role;
}
/** Static score evidence only. Names, sound names and row order cannot pick roles. */
export function analyse(notes: ViewNote[], active?: ReadonlySet<string>): Map<string, Part> {
  const parts = new Map<string, Part>();
  for (const [id, events] of indexScore(notes)) {
    parts.set(id, {
      id,
      events,
      hits: [],
      low: Infinity,
      high: -Infinity,
      density: 0,
      duration: 0,
      regularity: 0,
      phase: 0,
      meanPitch: Infinity,
      role: 'crate',
    });
  }
  for (const part of parts.values()) {
    part.events.sort((a, b) => a.note.start - b.note.start || a.note.end - b.note.end);
    part.hits = part.events.filter((e) => e.note.hasOnset);
    const cycles = new Set<number>();
    let pitched = 0,
      totalPitch = 0,
      gap = 0,
      gapSquare = 0,
      gaps = 0;
    for (const e of part.events) {
      if (e.pitch !== undefined) {
        part.low = Math.min(part.low, e.pitch);
        part.high = Math.max(part.high, e.pitch);
        totalPitch += e.pitch;
        pitched++;
      }
    }
    part.meanPitch = pitched ? totalPitch / pitched : Infinity;
    for (let i = 0; i < part.hits.length; i++) {
      const n = part.hits[i].note;
      cycles.add(Math.floor(n.start));
      part.duration += Math.max(0, n.end - n.start);
      part.phase += ((n.start % 1) + 1) % 1;
      const delta = i ? n.start - part.hits[i - 1].note.start : 0;
      // Section gaps are silence, not irregular drum timing.
      if (delta > 0 && delta <= 1) {
        gap += delta;
        gapSquare += delta * delta;
        gaps++;
      }
    }
    part.density = part.hits.length / Math.max(1, cycles.size);
    part.duration /= Math.max(1, part.hits.length);
    part.phase /= Math.max(1, part.hits.length);
    const mean = gap / Math.max(1, gaps);
    part.regularity =
      gaps && mean ? Math.sqrt(Math.max(0, gapSquare / gaps - mean * mean)) / mean : 1;
    part.role = pitched ? 'platform' : 'crate';
  }
  const pitched = [...parts.values()].filter(
    (p) => Number.isFinite(p.meanPitch) && (!active || active.has(p.id)),
  );
  pitched.sort((a, b) => a.meanPitch - b.meanPitch || a.low - b.low || a.id.localeCompare(b.id));
  if (pitched[0]) pitched[0].role = 'ground';
  const drums = [...parts.values()].filter(
    (p) => !Number.isFinite(p.meanPitch) && p.hits.length && (!active || active.has(p.id)),
  );
  // Short, regular and sparse: long atmosphere cannot win over percussive evidence.
  drums.sort(
    (a, b) =>
      Number(a.duration > 0.5) - Number(b.duration > 0.5) ||
      a.density * (1 + a.regularity) - b.density * (1 + b.regularity) ||
      a.phase - b.phase ||
      a.id.localeCompare(b.id),
  );
  if (drums[0]) drums[0].role = 'block';
  const coins = drums
    .filter((p) => p !== drums[0])
    .sort((a, b) => b.density - a.density || a.duration - b.duration || a.id.localeCompare(b.id));
  if (coins[0] && coins[0].density >= 4) coins[0].role = 'coin';
  // A lone dense drum is a coin ribbon; sparse single drums still get blocks.
  if (drums.length === 1 && drums[0].density >= 4) drums[0].role = 'coin';
  return parts;
}
export function upperBound(events: Event[], time: number) {
  let lo = 0,
    hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].note.start <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/** Semitone steps in logical pixels; wide registers fit into 24 pixels of terrain. */
export function groundHeight(part: Part | undefined, time: number) {
  if (part?.role !== 'ground') return 0;
  for (let i = upperBound(part.events, time) - 1; i >= 0; i--) {
    const e = part.events[i];
    if (e.pitch !== undefined)
      return Math.round((e.pitch - part.low) * Math.min(1, 24 / Math.max(1, part.high - part.low)));
  }
  return 0;
}
export function impact(start: number, now: number, cps: number, seconds = 0.22) {
  const age = (now - start) / Math.max(0.001, cps);
  return age >= 0 ? clamp(1 - age / seconds) : 0;
}
/** Only the block rhythm moves the camera; other hits keep their local effects.
 * A pitched-only level can use its terrain rhythm instead. */
export function cameraKick(
  parts: Map<string, Part>,
  frame: Pick<ViewFrame, 'now' | 'cps' | 'instruments'>,
) {
  let source: Part | undefined;
  for (const part of parts.values()) {
    if (part.role !== 'block' && part.role !== 'ground') continue;
    const instrument = frame.instruments.find((i) => i.id === part.id);
    if (!instrument?.inSection || instrument.muted) continue;
    source = part;
    if (part.role === 'block') break;
  }
  if (!source) return 0;
  const end = upperBound(source.hits, frame.now);
  return end ? impact(source.hits[end - 1].note.start, frame.now, frame.cps, 0.12) : 0;
}
/** Feet land on the top of a block exactly at its onset, then step off behind it.
 * Dense blocks use the same envelope's maximum, rather than accumulating jumps. */
export function characterHeight(
  ground: Part | undefined,
  blocks: Part | undefined,
  now: number,
  cps: number,
) {
  let jump = 0;
  if (blocks) {
    const duration = Math.min(0.24, Math.max(0.001, cps) * 0.46);
    const first = upperBound(blocks.hits, now - Math.max(0.001, cps) * 0.18) - 1;
    const last = upperBound(blocks.hits, now + duration);
    for (let i = Math.max(0, first); i < last; i++) {
      const age = now - blocks.hits[i].note.start;
      if (age <= 0) {
        const u = clamp(1 + age / duration);
        jump = Math.max(jump, 18 * u + 33 * 4 * u * (1 - u));
      } else jump = Math.max(jump, 18 * impact(blocks.hits[i].note.start, now, cps, 0.18));
    }
  }
  return groundHeight(ground, now) + jump;
}
/** Counts only onset-bearing coins supplied by the host, starting at max(0, from).
 * It never invents unseen history or increments mutable game state. */
export function coinCount(part: Part | undefined, now: number, from: number) {
  if (!part) return 0;
  return Math.max(0, upperBound(part.hits, now) - upperBound(part.hits, Math.max(0, from) - 1e-9));
}
export function sectionIndex(frame: Pick<ViewFrame, 'sections'>, now: number) {
  const length = frame.sections.at(-1)?.to ?? 0;
  const local = length > 0 ? ((now % length) + length) % length : now;
  return frame.sections.findIndex((s) => local >= s.from && local < s.to);
}
