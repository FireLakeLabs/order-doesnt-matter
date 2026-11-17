import type { ViewNote } from '../types';
import { indexScore, type Event } from './retro-2d';

export interface RoleEvidence {
  id: string;
  events: Event[];
  hits: Event[];
  low: number;
  high: number;
  density: number; // Onsets per occupied integer cycle.
  duration: number; // Mean onset-bearing scored span, in cycles.
  regularity: number; // Gap coefficient of variation, excluding gaps longer than one cycle.
  phase: number; // Mean onset phase within its cycle.
  meanPitch: number; // Mean MIDI of pitched spans; Infinity means unpitched.
}
/** Index once per score change; roles use scored timing/pitch, never names or sound identifiers. */
export function roleEvidence(notes: ViewNote[]): Map<string, RoleEvidence> {
  const parts = new Map<string, RoleEvidence>();
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
  }
  return parts;
}

/** Lowest mean scored pitch, then lowest extent and id, restricted to eligible ids when supplied. */
export function lowestPitchedPart(
  parts: ReadonlyMap<string, RoleEvidence>,
  eligible?: ReadonlySet<string>,
): string | undefined {
  return [...parts.values()]
    .filter((p) => Number.isFinite(p.meanPitch) && (!eligible || eligible.has(p.id)))
    .sort((a, b) => a.meanPitch - b.meanPitch || a.low - b.low || a.id.localeCompare(b.id))[0]?.id;
}
export interface DrumEvidence {
  id: string;
  density: number;
  regularity: number;
  downbeats: number;
}
/** Unique unpitched onsets, including section gaps, yield inverse mean spacing and rounded coefficient of variation. */
export function drumEvidence(part: RoleEvidence): DrumEvidence | undefined {
  const starts = [
    ...new Set(
      part.events.filter((e) => e.note.hasOnset && e.pitch === undefined).map((e) => e.note.start),
    ),
  ];
  if (!starts.length) return undefined;
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  const mean = gaps.reduce((sum, n) => sum + n, 0) / Math.max(1, gaps.length);
  const variation = gaps.reduce((sum, n) => sum + (n - mean) ** 2, 0) / Math.max(1, gaps.length);
  return {
    id: part.id,
    density: mean > 0 ? 1 / mean : 1,
    regularity: mean ? Math.round((Math.sqrt(variation) / mean) * 1e6) / 1e6 : 1,
    downbeats: starts.filter((t) => Math.abs(t - Math.round(t)) < 1e-6).length / starts.length,
  };
}
/** Pick by even spacing/downbeats (regular) or short sparse timing (sparse); eligible order breaks regular ties, id breaks sparse ties. */
export function mostRegularDrum(
  parts: ReadonlyMap<string, RoleEvidence>,
  policy: 'regular' | 'sparse' = 'regular',
  eligible: readonly string[] = [...parts.keys()],
): string | undefined {
  if (policy === 'sparse')
    return eligible
      .map((id) => parts.get(id))
      .filter((p): p is RoleEvidence => !!p && !Number.isFinite(p.meanPitch) && !!p.hits.length)
      .sort(
        (a, b) =>
          Number(a.duration > 0.5) - Number(b.duration > 0.5) ||
          a.density * (1 + a.regularity) - b.density * (1 + b.regularity) ||
          a.phase - b.phase ||
          a.id.localeCompare(b.id),
      )[0]?.id;
  return eligible
    .flatMap((id) => {
      const p = parts.get(id);
      const drum = p && drumEvidence(p);
      return drum ? [drum] : [];
    })
    .sort(
      (a, b) => a.regularity - b.regularity || b.downbeats - a.downbeats || a.density - b.density,
    )[0]?.id;
}
