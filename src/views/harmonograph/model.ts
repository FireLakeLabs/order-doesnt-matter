import type { ViewFrame, ViewNote } from '../types';
import { pitch, pitchClass } from '../shared/pitch';
import { noteProgress } from '../shared/timing';

export interface Tone {
  note: ViewNote;
  midi: number;
  hz: number;
}
export interface Pair {
  low: Tone;
  high: Tone;
  ratio: number;
  approximation: string | undefined;
  interval: string;
  shortName: string;
  shorter: ViewNote;
}
export interface OtherPair {
  pair: Pair;
  count: number;
  band?: string;
}
export interface PairSet {
  main?: Pair;
  others: OtherPair[];
  count: number;
  aggregated: boolean;
}
const pitchNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const pitchLabel = (midi: number) =>
  `${pitchNames[pitchClass(midi)]}${String(Math.floor(Math.round(midi) / 12) - 1)}`;
/** The frozen reader treats sample n as MIDI. Scaled n already arrives as note. */
const readPitch = (value: ViewNote['value']) => pitch({ ...value, n: undefined });
export const unpitched = (notes: readonly ViewNote[]) =>
  new Set(
    notes.filter((note) => readPitch(note.value) === undefined).map((note) => note.instrument),
  );
export function analyse(notes: readonly ViewNote[]): Tone[] {
  const groups = new Map<string, { onsets: Tone[]; continuations: Map<number, Tone> }>();
  for (const note of notes) {
    const midi = readPitch(note.value);
    if (midi === undefined) continue;
    const hz = 440 * 2 ** ((midi - 69) / 12);
    if (!(hz > 0 && Number.isFinite(hz))) continue;
    const key = JSON.stringify([note.instrument, note.start, note.end]);
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { onsets: [], continuations: new Map() }));
    const tone = { note, midi, hz };
    if (note.hasOnset) group.onsets.push(tone);
    else if (!group.continuations.has(midi)) group.continuations.set(midi, tone);
  }
  // Repeated whole-span fragments continue one voice; distinct onsets remain distinct.
  return [...groups.values()]
    .flatMap((group) => (group.onsets.length ? group.onsets : [...group.continuations.values()]))
    .sort(
      (a, b) =>
        a.midi - b.midi ||
        a.note.instrument.localeCompare(b.note.instrument) ||
        a.note.start - b.note.start ||
        a.note.end - b.note.end,
    );
}

export function sounding(frame: ViewFrame, tones: readonly Tone[]) {
  const muted = new Set(frame.instruments.filter((i) => i.muted).map((i) => i.id));
  return tones.filter(
    (t) => t.note.start <= frame.now && frame.now < t.note.end && !muted.has(t.note.instrument),
  );
}
const intervals = [
  ['unison', 'P1'],
  ['minor second', 'm2'],
  ['major second', 'M2'],
  ['minor third', 'm3'],
  ['major third', 'M3'],
  ['perfect fourth', 'P4'],
  ['tritone', 'TT'],
  ['perfect fifth', 'P5'],
  ['minor sixth', 'm6'],
  ['major sixth', 'M6'],
  ['minor seventh', 'm7'],
  ['major seventh', 'M7'],
  ['octave', 'P8'],
  ['minor ninth', 'm9'],
  ['major ninth', 'M9'],
  ['minor tenth', 'm10'],
  ['major tenth', 'M10'],
  ['perfect eleventh', 'P11'],
  ['augmented eleventh', 'A11'],
  ['perfect twelfth', 'P12'],
  ['minor thirteenth', 'm13'],
  ['major thirteenth', 'M13'],
  ['minor fourteenth', 'm14'],
  ['major fourteenth', 'M14'],
  ['two octaves', 'P15'],
];
export function intervalName(semitones: number) {
  const nearest = Math.round(semitones),
    cents = (semitones - nearest) * 100;
  const base = intervals[nearest] ?? [
    `${String(Math.floor(nearest / 12))} octaves + ${intervals[nearest % 12][0]}`,
    `${String(nearest)} st`,
  ];
  const detune = Math.abs(cents) >= 0.05 ? ` ${cents >= 0 ? '+' : ''}${cents.toFixed(1)}¢` : '';
  return { name: base[0] + detune, short: base[1] + detune };
}
/** Display only: small rational approximations never set the pendulum rates. */
export function approximate(ratio: number) {
  let numerator = Math.round(ratio),
    denominator = 1,
    error = Math.abs(ratio - numerator);
  for (let d = 2; d <= 8; d++) {
    const n = Math.round(ratio * d),
      delta = Math.abs(ratio - n / d);
    if (delta < error - 1e-12) {
      numerator = n;
      denominator = d;
      error = delta;
    }
  }
  return error / ratio <= 0.015 ? `${String(numerator)} : ${String(denominator)}` : undefined;
}
export function pair(low: Tone, high: Tone): Pair {
  const ratio = 2 ** ((high.midi - low.midi) / 12);
  const interval = intervalName(high.midi - low.midi);
  const lowSpan = low.note.end - low.note.start,
    highSpan = high.note.end - high.note.start;
  const shorter =
    lowSpan < highSpan || (lowSpan === highSpan && low.note.start > high.note.start)
      ? low.note
      : high.note;
  return {
    low,
    high,
    ratio,
    approximation: approximate(ratio),
    interval: interval.name,
    shortName: interval.short,
    shorter,
  };
}
const bands = ['0–2 st', '2–5 st', '5–9 st', '9–13 st', '13–25 st', '25+ st'];
/** Every pair contributes. Crowds become six counted interval bands with a representative figure. */
export function pairing(tones: readonly Tone[]): PairSet {
  const count = (tones.length * (tones.length - 1)) / 2;
  if (!count) return { others: [], count: 0, aggregated: false };
  const main = pair(tones[0], tones[tones.length - 1]);
  const aggregated = count > 6,
    others: OtherPair[] = [],
    bins = new Map<number, OtherPair>();
  for (let i = 0; i < tones.length; i++)
    for (let j = i + 1; j < tones.length; j++) {
      if (i === 0 && j === tones.length - 1) continue;
      if (!aggregated) {
        others.push({ pair: pair(tones[i], tones[j]), count: 1 });
        continue;
      }
      const gap = tones[j].midi - tones[i].midi;
      const bin = gap < 2 ? 0 : gap < 5 ? 1 : gap < 9 ? 2 : gap < 13 ? 3 : gap < 25 ? 4 : 5;
      const existing = bins.get(bin);
      if (existing) existing.count++;
      else bins.set(bin, { pair: pair(tones[i], tones[j]), count: 1, band: bands[bin] });
    }
  return {
    main,
    others: aggregated ? [...bins].sort((a, b) => a[0] - b[0]).map(([, value]) => value) : others,
    count,
    aggregated,
  };
}
/** Unit geometry. Time is normalized by the lower pitch, retaining the exact frequency ratio.
 * Very wide intervals shorten the trace horizon to bound oscillations, never snap rates. */
export function trace(pair: Pair, now: number, small = false) {
  const progress = noteProgress(pair.shorter, now);
  const turns = Math.min(small ? 10 : 20, 240 / Math.max(1, pair.ratio));
  const samples = Math.min(
    small ? 1024 : 4096,
    Math.max(small ? 320 : 720, Math.ceil(turns * pair.ratio * 24)),
  );
  const steps = Math.ceil(samples * progress);
  const points = new Float32Array((steps + 1) * 2);
  for (let i = 0; i <= steps; i++) {
    const u = Math.min(i / samples, progress),
      t = Math.PI * 2 * turns * u,
      radius = 0.42 ** u;
    points[i * 2] = radius * Math.sin(t + Math.PI / 4);
    points[i * 2 + 1] = radius * Math.sin(pair.ratio * t);
  }
  return { points, progress, turns, envelope: 0.42 ** progress };
}
export function layout(width: number, height: number, others: number) {
  const below = width < 900 && others > 0 && (height - 300) / 2 > width * 0.73 * 0.47;
  const side = others > 0 && !below;
  const mainWidth = side ? width * 0.73 : width;
  const chartHeight = height - (below ? 300 : 64);
  const radius = Math.max(
    20,
    Math.min(chartHeight / 2, mainWidth * 0.47, Math.max((225 * width) / 960, height * 0.36)),
  );
  const miniColumns = below ? 3 : others > 3 ? 2 : 1;
  return {
    below,
    side,
    mainWidth,
    radius,
    cx: side ? width * 0.4 : width / 2,
    cy: chartHeight / 2,
    captionY: chartHeight + 28,
    chartHeight,
    miniColumns,
    miniX: below ? 16 : width * 0.755,
    miniY: below ? chartHeight + 78 : 82,
    miniWidth: below ? width - 32 : width * 0.23,
    miniHeight: below ? 200 : height - 96,
    miniRows: Math.max(1, Math.ceil(others / miniColumns)),
  };
}
