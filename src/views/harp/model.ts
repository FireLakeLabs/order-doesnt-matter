import type { ViewFrame, ViewNote } from '../types';
import { pitch, pitchClass } from '../shared/pitch';
import { clamp } from '../shared/math';
import { noteProgress } from '../shared/timing';

export interface Voice {
  note: ViewNote;
  midi: number | undefined;
}
export interface StringSlot {
  pitches: number[];
  voices: Voice[];
  label: string;
}
export interface HarpScore {
  strings: StringSlot[];
  drums: { instrument: string; voices: Voice[] }[];
  pitchCount: number;
  grouped: boolean;
}
export function pitchLabel(midi: number) {
  const names = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const cents = Math.round((midi - Math.round(midi)) * 100);
  return `${names[pitchClass(midi)]}${String(Math.floor(Math.round(midi) / 12) - 1)}${cents ? `${cents > 0 ? '+' : ''}${String(cents)}¢` : ''}`;
}
/** The engine ignores bare sample n; scaled n arrives as note. Keep the frozen reader. */
const readPitch = (value: ViewNote['value']) => pitch({ ...value, n: undefined });
export function analyse(notes: readonly ViewNote[]): HarpScore {
  const spans = new Map<string, { onsets: Voice[]; fragments: Map<number | undefined, Voice> }>();
  for (const note of notes) {
    const key = JSON.stringify([note.instrument, note.start, note.end]);
    let span = spans.get(key);
    if (!span) spans.set(key, (span = { onsets: [], fragments: new Map() }));
    const voice = { note, midi: readPitch(note.value) };
    if (note.hasOnset) span.onsets.push(voice);
    else if (!span.fragments.has(voice.midi)) span.fragments.set(voice.midi, voice);
  }
  const pitches = new Map<number, Voice[]>(),
    drums = new Map<string, Voice[]>();
  for (const span of spans.values())
    for (const voice of span.onsets.length ? span.onsets : span.fragments.values()) {
      // Separate maps preserve instruments that have both pitched and unpitched events.
      if (voice.midi === undefined) {
        const group = drums.get(voice.note.instrument) ?? [];
        group.push(voice);
        drums.set(voice.note.instrument, group);
      } else {
        const group = pitches.get(voice.midi) ?? [];
        group.push(voice);
        pitches.set(voice.midi, group);
      }
    }
  const sorted = [...pitches].sort(([a], [b]) => a - b),
    grouped = sorted.length > 40;
  const slots = new Map<number, StringSlot>();
  for (const [midi, voices] of sorted) {
    const key = grouped ? Math.floor(midi / 12) : midi;
    let slot = slots.get(key);
    if (!slot)
      slots.set(
        key,
        (slot = {
          pitches: [],
          voices: [],
          label: grouped ? `oct ${String(key - 1)}` : pitchLabel(midi),
        }),
      );
    slot.pitches.push(midi);
    slot.voices.push(...voices);
  }
  return {
    strings: [...slots.values()],
    drums: [...drums]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([instrument, voices]) => ({ instrument, voices })),
    pitchCount: sorted.length,
    grouped,
  };
}
export function sectionAt(f: Pick<ViewFrame, 'sections' | 'now' | 'from' | 'to'>) {
  const length = f.sections.at(-1)?.to ?? 0;
  const offset = length > 0 ? Math.floor(f.now / length) * length : 0;
  const section = f.sections.find((s) => f.now >= s.from + offset && f.now < s.to + offset);
  return section
    ? { name: section.name, from: section.from + offset, to: section.to + offset }
    : { name: 'whole song', from: f.from, to: f.to };
}
export interface Part {
  instrument: string;
  voices: Voice[];
}
/** Half-open scored spans, independent of playing; all overlapping voices contribute. */
export function partsAt(
  voices: readonly Voice[],
  f: Pick<ViewFrame, 'now' | 'instruments'>,
): Part[] {
  const muted = new Set(f.instruments.filter((i) => i.muted).map((i) => i.id));
  const owners = new Map<string, Voice[]>();
  for (const voice of voices) {
    const n = voice.note;
    if (n.start > f.now || n.end <= f.now || muted.has(n.instrument)) continue;
    const group = owners.get(n.instrument) ?? [];
    group.push(voice);
    owners.set(n.instrument, group);
  }
  return [...owners]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([instrument, voices]) => ({ instrument, voices }));
}
export const usesSection = (voices: readonly Voice[], section: { from: number; to: number }) =>
  voices.some(({ note }) => note.start < section.to && note.end > section.from);
export function motion(part: Part, now: number, phase: number) {
  let a = 0,
    b = 0,
    power = 0,
    pluck = 0;
  for (const { note } of part.voices) {
    const gain =
      typeof note.value.gain === 'number' && Number.isFinite(note.value.gain)
        ? Math.max(0, note.value.gain)
        : 1;
    const p = noteProgress(note, now),
      decay = 1 - 0.5 * p;
    a += gain * Math.cos(p * Math.PI * 16 + phase) * decay;
    b += gain * Math.sin(p * Math.PI * 12 + phase) * decay;
    power += gain * gain;
    if (note.hasOnset) pluck = Math.max(pluck, (1 - p) ** 3);
  }
  const divisor = Math.sqrt(Math.max(1, part.voices.length));
  return { a: a / divisor, b: b / divisor, gain: Math.sqrt(power), pluck };
}
/** Triangular initial displacement peaks exactly one third down; endpoints stay anchored. */
export function displacement(u: number, state: ReturnType<typeof motion>) {
  const triangle = u < 1 / 3 ? u * 3 : (1 - u) * 1.5;
  return state.a * triangle + 0.8 * state.b * Math.sin(Math.PI * 6 * u);
}
export function layout(width: number, height: number, stringCount: number, drumCount: number) {
  const left = width * 0.085,
    right = width * 0.93,
    top = 94;
  const sideColumns = Math.max(1, Math.floor((width * 0.43) / 52));
  const strip = drumCount > sideColumns || height < 450;
  const columns = strip ? Math.max(1, Math.floor((width - 40) / 44)) : sideColumns;
  const rows = Math.ceil(drumCount / columns);
  const drumHeight = drumCount ? rows * 34 + 18 : 0;
  const bottom = Math.max(top + 60, height - (strip && drumCount ? drumHeight + 38 : 30));
  return {
    left,
    right,
    top,
    bottom,
    spacing: stringCount > 1 ? (right - left) / (stringCount - 1) : right - left,
    scale: Math.max(0.65, width / 960),
    drumLeft: strip ? 20 : width * 0.52,
    drumWidth: strip ? width - 40 : width * 0.43,
    drumTop: height - drumHeight - 4,
    columns,
    rows,
    strip,
  };
}
export function stringGeometry(g: ReturnType<typeof layout>, index: number, count: number) {
  const u = count > 1 ? index / (count - 1) : 0.5,
    height = g.bottom - g.top;
  return {
    x: g.left + (g.right - g.left) * u,
    top: g.top + height * (0.08 * u + 0.2 * u * u),
    bottom: g.bottom - height * 0.28 * u,
  };
}
export const shimmerWidth = (gain: number, g: ReturnType<typeof layout>) =>
  clamp(20 * gain * g.scale, 0, g.spacing * 0.26);
