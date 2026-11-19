import type { ViewFrame, ViewNote } from '../types';
import { pitch, pitchClass } from '../shared/pitch';
import { roleEvidence, mostRegularDrum } from '../shared/roles';

// Bare n is a sample index, not a scored pitch (same reading as Chord bridge).
export const readPitch = (n: ViewNote) => pitch({ ...n.value, n: undefined });
const signatures = [0, -5, 2, -3, 4, -1, -6, 1, -4, 3, -2, 5];
const major = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const minor = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
const flatNames = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
const sharpNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
/** Mirrors Chord bridge's fewest foreign classes / simplest signature approach.
 * Bass tonic duration breaks relative-key ambiguity. This is a window estimate. */
export function inferKey(notes: ViewNote[]) {
  const pitches = notes.flatMap((n) => {
    const p = readPitch(n);
    return p === undefined ? [] : [p];
  });
  if (!pitches.length) return { name: 'C', label: 'no pitched key', flats: false };
  const classes = new Set(pitches.map(pitchClass));
  let best = Infinity,
    result = { name: 'C', label: 'C major', flats: false };
  for (let root = 0; root < 12; root++) {
    for (const mode of [0, 1, 2]) {
      const scale = mode === 0 ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, mode === 2 ? 11 : 10];
      const members = new Set(scale.map((n) => (n + root) % 12));
      const signature = signatures[(root + (mode ? 3 : 0)) % 12];
      const tonic = notes.reduce((sum, n) => {
        const p = readPitch(n);
        return (
          sum +
          (p !== undefined && pitchClass(p) === root
            ? Math.min(1, Math.max(0, n.end - n.start)) / (1 + Math.max(0, p - 36) / 12)
            : 0)
        );
      }, 0);
      const score =
        [...classes].filter((p) => !members.has(p)).length * 100 +
        Math.abs(signature) -
        Math.min(8, tonic * 2);
      if (score < best) {
        best = score;
        result = {
          name: mode ? minor[root] : major[root],
          label: mode ? `${minor[root].slice(0, -1)} minor` : `${major[root]} major`,
          flats: signature < 0,
        };
      }
    }
  }
  return result;
}
export function writtenPitch(midi: number, flats: boolean, octave = 0) {
  const n = Math.round(midi) + octave * 12;
  return `${(flats ? flatNames : sharpNames)[pitchClass(n)]}/${String(Math.floor(n / 12) - 1)}`;
}
/** VexFlow values in 64th-note ticks, including dotted values. */
const values = [64, 48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1];
export function nearestValue(cycles: number) {
  const ticks = cycles * 64;
  if (ticks > 64)
    return { ticks: Math.round(ticks), approximate: Math.abs(ticks - Math.round(ticks)) > 1e-6 };
  const value = values.reduce((a, b) => (Math.abs(b - ticks) < Math.abs(a - ticks) ? b : a));
  return { ticks: value, approximate: Math.abs(value - ticks) > 1e-6 };
}
export function duration(ticks: number) {
  const dotted = [48, 24, 12, 6, 3].includes(ticks);
  return { value: String(64 / (dotted ? ticks / 1.5 : ticks)), dotted };
}
export interface Mark {
  tick: number;
  ticks: number;
  notes: ViewNote[];
  rest: boolean;
  approximate: boolean;
  tieIn: boolean;
  tieOut: boolean;
}
export interface Measure {
  bar: number;
  marks: Mark[];
  count: number;
  approximate: number;
  grouped: boolean;
}
/** Split at beats when necessary, filling every gap with real rests. */
function split(
  start: number,
  end: number,
  notes: ViewNote[],
  approximate = false,
  tieIn = false,
  tieOut = false,
): Mark[] {
  const result: Mark[] = [];
  while (start < end) {
    const left = end - start;
    const ticks =
      values.find((v) => v <= left && (start % 16 === 0 || v <= 16 - (start % 16))) ?? 1;
    result.push({
      tick: start,
      ticks,
      notes,
      rest: !notes.length,
      approximate: approximate && !result.length,
      tieIn: !!notes.length && (tieIn || !!result.length),
      tieOut: !!notes.length && (tieOut || start + ticks < end),
    });
    start += ticks;
  }
  return result;
}
export function measure(notes: ViewNote[], bar: number, budget: number): Measure {
  const active = notes.filter(
    (n) => n.start < bar + 1 && (n.end > bar || (n.end <= n.start && n.start >= bar)),
  );
  const events = new Map<string, ViewNote[]>();
  for (const n of active) {
    const key = `${String(n.start)}:${String(n.end)}`;
    const group = events.get(key) ?? [];
    group.push(n);
    events.set(key, group);
  }
  const marks: Mark[] = [];
  let cursor = 0,
    approximate = 0,
    grouped = active.length > budget || active.some((n) => n.end <= n.start);
  for (const chord of [...events.values()].sort((a, b) => a[0].start - b[0].start)) {
    const n = chord[0];
    const start = Math.max(0, Math.round((n.start - bar) * 64));
    const rounded = nearestValue(n.end - n.start);
    const end = Math.min(64, Math.max(start + 1, Math.round((n.start - bar) * 64) + rounded.ticks));
    const approx =
      rounded.approximate ||
      Math.abs((n.start - bar) * 64 - Math.round((n.start - bar) * 64)) > 1e-6 ||
      chord.some((n) => {
        const p = readPitch(n);
        return p !== undefined && Math.abs(p - Math.round(p)) > 1e-6;
      });
    if (approx) approximate += chord.length;
    if (
      start < cursor ||
      chord.length > 8 ||
      (readPitch(chord[0]) !== undefined && new Set(chord.map(readPitch)).size !== chord.length) ||
      chord.some((n) => {
        const p = readPitch(n);
        return p !== undefined && (p < 12 || p > 96);
      })
    )
      grouped = true;
    marks.push(...split(cursor, start, []));
    marks.push(...split(start, end, chord, approx, n.start < bar || !n.hasOnset, n.end > bar + 1));
    cursor = Math.max(cursor, end);
  }
  marks.push(...split(cursor, 64, []));
  return { bar, marks: grouped ? [] : marks, count: active.length, approximate, grouped };
}
export type DrumRole = 'kick' | 'snare' | 'hat' | 'open hat' | 'percussion';
export interface Part {
  id: string;
  source: string;
  name: string;
  notes: ViewNote[];
  clef: 'bass' | 'treble' | 'percussion';
  octave: number;
  role?: DrumRole;
  dynamics: string;
  cutoff?: string;
}
export const dynamic = (gain: number) =>
  gain < 0.3 ? 'pp' : gain < 0.5 ? 'p' : gain < 0.7 ? 'mf' : gain <= 1 ? 'f' : 'ff';
export function staffScore(frame: ViewFrame) {
  // Whole spans may be repeated as continuation fragments by adjacent queries.
  const spans = new Map<string, { onsets: ViewNote[]; carried: Map<string, ViewNote> }>();
  for (const n of frame.notes) {
    const key = JSON.stringify([n.instrument, n.start, n.end]);
    const span = spans.get(key) ?? { onsets: [], carried: new Map<string, ViewNote>() };
    if (n.hasOnset) span.onsets.push(n);
    else span.carried.set(JSON.stringify(n.value), n);
    spans.set(key, span);
  }
  const notes = [...spans.values()].flatMap((s) =>
    s.onsets.length ? s.onsets : [...s.carried.values()],
  );
  const evidence = roleEvidence(notes.map((n) => ({ ...n, value: { ...n.value, n: undefined } })));
  const range = scoreRange(frame);
  const drumParts = roleEvidence(
    notes
      .filter((n) => n.start < range.from + range.bars && n.end > range.from)
      .map((n) => ({ ...n, value: { ...n.value, n: undefined } })),
  );
  const unpitched = [...drumParts.values()].filter((p) => !Number.isFinite(p.meanPitch));
  const hat = unpitched
    .filter((p) => p.density >= 4 && p.duration <= 0.25)
    .sort(
      (a, b) =>
        b.density - a.density ||
        a.duration - b.duration ||
        Math.abs(a.phase - 0.5) - Math.abs(b.phase - 0.5) ||
        a.id.localeCompare(b.id),
    )[0]?.id;
  const kick = mostRegularDrum(
    drumParts,
    'regular',
    unpitched.filter((p) => p.id !== hat && p.duration <= 0.5).map((p) => p.id),
  );
  const snare = unpitched
    .filter((p) => p.id !== kick && p.id !== hat && p.duration <= 0.5)
    .sort(
      (a, b) =>
        Math.abs(a.phase - 0.5) - Math.abs(b.phase - 0.5) ||
        a.density - b.density ||
        a.id.localeCompare(b.id),
    )[0]?.id;
  const parts: Part[] = frame.instruments.flatMap((i) => {
    const own = notes.filter((n) => n.instrument === i.id);
    const mean = evidence.get(i.id)?.meanPitch ?? Infinity;
    const visible = own.filter((n) => n.start < range.from + range.bars && n.end > range.from);
    const gains = visible.map((n) => Number(n.value.gain ?? 1)).filter(Number.isFinite);
    const lo = gains.length ? dynamic(Math.min(...gains)) : '',
      hi = gains.length ? dynamic(Math.max(...gains)) : '';
    const cutoff = visible
      .filter((n) => n.end - n.start >= 0.5)
      .map((n) => Number(n.value.cutoff ?? n.value.lpf))
      .filter(Number.isFinite);
    const minCutoff = Math.round(Math.min(...cutoff)),
      maxCutoff = Math.round(Math.max(...cutoff));
    const part: Part = {
      id: i.id,
      source: i.id,
      name: i.name,
      notes: own,
      clef: Number.isFinite(mean) ? (mean < 60 ? 'bass' : 'treble') : 'percussion',
      octave: (evidence.get(i.id)?.low ?? Infinity) < 36 ? 1 : 0,
      role: Number.isFinite(mean)
        ? undefined
        : i.id === kick
          ? 'kick'
          : i.id === hat
            ? 'hat'
            : i.id === snare
              ? 'snare'
              : hat &&
                  (drumParts.get(i.id)?.density ?? 0) >= 2 &&
                  (drumParts.get(i.id)?.duration ?? 1) <= 0.25
                ? 'open hat'
                : 'percussion',
      dynamics: lo === hi ? lo : `${lo}–${hi}`,
      cutoff: cutoff.length
        ? `lpf ${String(minCutoff)}${minCutoff === maxCutoff ? '' : `–${String(maxCutoff)}`} Hz · held`
        : undefined,
    };
    const low = own.filter((n) => (readPitch(n) ?? -Infinity) < 60);
    const high = own.filter((n) => (readPitch(n) ?? -Infinity) >= 60);
    if (Number.isFinite(mean) && low.length && high.length) {
      return [
        {
          ...part,
          id: `${i.id}:bass`,
          name: `${i.name} · bass`,
          notes: low,
          clef: 'bass' as const,
        },
        {
          ...part,
          id: `${i.id}:treble`,
          name: `${i.name} · treble`,
          notes: high,
          clef: 'treble' as const,
          octave: 0,
        },
      ];
    }
    return [part];
  });
  return { notes, parts, key: inferKey(notes) };
}
export function scoreRange(frame: ViewFrame) {
  const from = Math.floor(frame.now);
  const bars = Math.max(1, Math.min(8, Math.ceil(frame.lookAhead)));
  return {
    from,
    bars,
    asked: Array.from(
      { length: bars },
      (_, i) => from + i >= frame.from && from + i + 1 <= frame.to,
    ),
  };
}

/** Space for ledger lines on pitched staves and both stem directions on the kit. */
export function staffLayout(clefs: Part['clef'][], height: number, bars: number) {
  const minimum = clefs.map((c) => (c === 'percussion' ? 144 : 100));
  const sum = minimum.reduce((a, b) => a + b, 0),
    available = Math.max(0, height - 125);
  const wanted = Math.max(1, Math.min(bars, Math.floor(available / (sum + 24))));
  const columns = Math.ceil(bars / wanted),
    systems = Math.ceil(bars / columns);
  const extra = Math.max(0, (available - sum * systems) / Math.max(1, clefs.length * systems));
  const heights = minimum.map((h) => h + extra);
  let systemHeight = 0;
  const tops = heights.map((h) => {
    const y = systemHeight;
    systemHeight += h;
    return y;
  });
  return {
    top: 68,
    bottom: 68 + systemHeight * systems,
    columns,
    systems,
    systemHeight,
    tops,
    heights,
  };
}

export const staffCapacity = (height: number, percussion: boolean) =>
  Math.max(1, Math.floor((height - 120 - (percussion ? 44 : 0)) / 100));
