import type { ViewNote } from '../types';

/** Read MIDI from note, then n, then frequency; numeric strings and octave-less notes retain legacy semantics. */
export function pitch(value: ViewNote['value'], numericFrequencyOnly = false): number | undefined {
  const raw = value.note ?? value.n;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    if (raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
    const m = /^([a-g])([#b]?)(-?\d+)?$/i.exec(raw.trim());
    if (m) {
      const key = 'c d ef g a b'.indexOf(m[1].toLowerCase());
      return (Number(m[3] || 3) + 1) * 12 + key + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    }
  }
  const freq = numericFrequencyOnly && typeof value.freq !== 'number' ? NaN : Number(value.freq);
  return freq > 0 && Number.isFinite(freq) ? 69 + 12 * Math.log2(freq / 440) : undefined;
}
const trackerNames = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
/** Tracker spelling of the nearest MIDI semitone, with octave and a dash for naturals. */
export const pitchName = (p: number) =>
  `${trackerNames[((Math.round(p) % 12) + 12) % 12]}${String(Math.floor(Math.round(p) / 12) - 1)}`;

/** Nearest semitone's pitch class in [0, 11], including negative MIDI coordinates. */
export const pitchClass = (midi: number) => ((Math.round(midi) % 12) + 12) % 12;
const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Conventional sharp note spelling of the nearest MIDI semitone, including octave. */
export const noteName = (midi: number) =>
  `${names[pitchClass(midi)]}${String(Math.floor(Math.round(midi) / 12) - 1)}`;
// Symmetric augmented triads and diminished sevenths have no unique root.
const chords: readonly [string, readonly number[]][] = [
  ['', [0, 4, 7]],
  ['m', [0, 3, 7]],
  ['dim', [0, 3, 6]],
  ['7', [0, 4, 7, 10]],
  ['maj7', [0, 4, 7, 11]],
  ['m7', [0, 3, 7, 10]],
  ['mMaj7', [0, 3, 7, 11]],
  ['m7b5', [0, 3, 6, 10]],
];
/** Name an exact, uniquely rooted triad or seventh (within 1e−6 semitone); ambiguous/incomplete sets return undefined. */
export function chordName(pitches: readonly number[]): string | undefined {
  if (pitches.some((p) => !Number.isFinite(p) || Math.abs(p - Math.round(p)) > 1e-6))
    return undefined;
  const classes = new Set(pitches.map(pitchClass));
  if (classes.size !== 3 && classes.size !== 4) return undefined;
  let result: string | undefined;
  for (const root of classes)
    for (const [suffix, intervals] of chords) {
      if (
        intervals.length !== classes.size ||
        !intervals.every((i) => classes.has((root + i) % 12))
      )
        continue;
      if (result !== undefined) return undefined;
      result = names[root] + suffix;
    }
  return result;
}
