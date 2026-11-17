import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { clamp } from '../shared/math';
import { flightProgress } from '../shared/timing';
import { noteName, pitch } from '../shared/pitch';

export type Garment = 'hat' | 'cape' | 'spikes' | 'antenna' | 'boots' | 'size' | 'side' | 'badge';
export interface OutfitItem {
  name: string;
  value: unknown;
  garment: Garment;
  size: number;
}
const garments: Record<string, Garment> = {
  lpf: 'hat',
  cutoff: 'hat',
  room: 'cape',
  shape: 'spikes',
  resonance: 'antenna',
  lpq: 'antenna',
  hpf: 'boots',
  hcutoff: 'boots',
  gain: 'size',
  pan: 'side',
};
const numeric = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Absolute scales keep a held outfit unchanged when the host replaces its window. */
export function outfit(note: ViewNote): OutfitItem[] {
  return Object.keys(note.value)
    .sort()
    .map((name) => {
      const value = note.value[name];
      const garment = Object.hasOwn(garments, name) ? garments[name] : 'badge';
      const n = numeric(value, 0);
      const size =
        garment === 'hat' || garment === 'boots'
          ? clamp(Math.log2(1 + Math.max(0, n)) / Math.log2(20001))
          : garment === 'antenna'
            ? clamp(n / 30)
            : garment === 'size'
              ? clamp(n / 2)
              : garment === 'badge'
                ? (2 / Math.PI) * Math.atan(Math.abs(n))
                : clamp(n);
      return { name, value, garment, size };
    });
}
export function valueText(value: unknown): string {
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(Number(value.toFixed(3))) : String(value);
  if (typeof value === 'string') return value;
  return value === undefined ? 'undefined' : JSON.stringify(value);
}
export function noteTitle(note: ViewNote): string {
  const p = pitch(note.value);
  return p === undefined ? '' : noteName(p);
}
export interface Figure {
  note: ViewNote;
  instrument: ViewInstrument;
  members: ViewNote[];
  outfit: OutfitItem[];
  posing: boolean;
  progress: number;
  x: number;
  y: number;
  scale: number;
  stride: number;
}
export interface Runway {
  back: number;
  front: number;
  backWidth: number;
  frontWidth: number;
}
export function runway(frame: Pick<ViewFrame, 'width' | 'height'>): Runway {
  return {
    back: frame.height * 0.29,
    front: frame.height * 0.88,
    backWidth: frame.width * 0.13,
    frontWidth: frame.width * 0.78,
  };
}

/** viewNotes retains query fragments. Identical continuations of an onset are
 * one held outfit, while coincident onsets remain genuine polyphony. */
export function scoredNotes(notes: ViewNote[]): ViewNote[] {
  const key = (n: ViewNote) =>
    JSON.stringify([
      n.instrument,
      n.start,
      n.end,
      Object.keys(n.value)
        .sort()
        .map((k) => [k, n.value[k]]),
    ]);
  const onsets = new Set(notes.filter((n) => n.hasOnset).map(key));
  return notes.filter((n) => {
    if (n.hasOnset) return true;
    const id = key(n);
    return !onsets.has(id);
  });
}

/** Every visible scored span contributes to a figure or its explicit crowd count. */
export function figures(frame: ViewFrame, notes = scoredNotes(frame.notes)): Figure[] {
  const instruments = new Map(frame.instruments.map((i) => [i.id, i]));
  const visible = notes.filter(
    (n) =>
      n.end > frame.now &&
      n.start <= frame.now + frame.lookAhead &&
      (n.start <= frame.now || n.hasOnset) &&
      instruments.has(n.instrument),
  );
  // The document inventory fixes the fan and crowd policy throughout a hold.
  // Notes entering/leaving the Window must never move an unrelated poser.
  const ids = [...frame.instruments].sort((a, b) => a.index - b.index).map((i) => i.id);
  // Alternate outward from the centre, keeping adjacent parts on opposite
  // sides even when an arrangement leaves a long run of earlier rows resting.
  const slots = new Map(
    ids.map((id, i) => [
      id,
      i === 0 ? 0 : ((i % 2 ? 1 : -1) * Math.ceil(i / 2)) / Math.ceil((ids.length - 1) / 2),
    ]),
  );
  const r = runway(frame);
  const capacity = Math.max(2, Math.min(6, Math.floor(frame.width / 180)));
  const groups = new Map<string, Figure>();
  for (const note of visible) {
    const instrument = instruments.get(note.instrument);
    if (!instrument) continue;
    const posing = note.start <= frame.now;
    const progress = flightProgress(note, frame.now, frame.lookAhead);
    const pan = clamp(numeric(note.value.pan, 0.5));
    // Neutral notes fan out by instrument; explicit pan still determines the side.
    const fan = (slots.get(note.instrument) ?? 0) * 0.6;
    const offset = (pan - 0.5) * 1.6;
    const side = clamp(pan === 0.5 ? fan : offset + (fan * Math.abs(offset)) / 1.2, -0.9, 0.9);
    const breadth = r.backWidth + (r.frontWidth - r.backWidth) * progress;
    const x = frame.width / 2 + side * breadth * 0.5;
    const depth = posing ? 'front' : String(Math.floor(progress * 8));
    const crowded = ids.length > capacity;
    const lane = crowded
      ? String(Math.floor(((side + 1) / 2) * capacity))
      : `${note.instrument}:${String(Math.floor(pan * 4))}`;
    const key = `${lane}:${depth}`;
    const items = outfit(note);
    const gain = clamp(numeric(note.value.gain, 1), 0, 4);
    const body = Math.min(frame.height / 520, frame.width / 720);
    const candidate: Figure = {
      note,
      instrument,
      members: [note],
      outfit: items,
      posing,
      progress,
      x,
      y: r.back + (r.front - r.back) * progress,
      scale: body * (0.35 + progress * 0.95) * (0.55 + Math.sqrt(gain) * 0.45),
      stride: posing ? 0 : Math.sin(progress * Math.PI * 14 + instrument.index) * 8,
    };
    const existing = groups.get(key);
    if (existing) {
      existing.members.push(note);
      // The earliest arrival anchors a crowd; equally timed notes feature the
      // richest real bag, with that same note's gain and pan.
      if (
        note.start < existing.note.start ||
        (note.start === existing.note.start && items.length > existing.outfit.length)
      )
        Object.assign(existing, candidate, { members: existing.members });
    } else groups.set(key, candidate);
  }
  return [...groups.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Tags feature actual posing bags, prioritising the most dressed notes. */
export function featured(cast: Figure[], width: number): Figure[] {
  return cast
    .filter((f) => f.posing)
    .sort((a, b) => b.outfit.length - a.outfit.length || a.instrument.index - b.instrument.index)
    .slice(0, width < 700 ? 1 : 2);
}
