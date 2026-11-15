import type { ViewFrame, ViewNote } from '../types';

export const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));

function parsePitch(note: unknown): number | undefined {
  if (typeof note === 'number' && Number.isFinite(note)) return note;
  if (typeof note === 'string') {
    const numeric = Number(note);
    if (note.trim() && Number.isFinite(numeric)) return numeric;
    const match = /^([a-g])([#bsf]*)(-?\d+)?$/i.exec(note);
    if (match) {
      const semitones: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
      const semitone = semitones[match[1].toLowerCase()];
      let accidental = 0;
      for (const mark of match[2]) accidental += /[#s]/i.test(mark) ? 1 : -1;
      return (Number(match.at(3) ?? 3) + 1) * 12 + semitone + accidental;
    }
  }
  return undefined;
}

export function pitch(value: ViewNote['value']): number | undefined {
  const parsed = parsePitch(value.note) ?? parsePitch(value.n);
  if (parsed !== undefined) return parsed;
  const frequency = Number(value.freq);
  return frequency > 0 && Number.isFinite(frequency)
    ? 69 + 12 * Math.log2(frequency / 440)
    : undefined;
}

export function layout(frame: Pick<ViewFrame, 'width' | 'height' | 'instruments'>) {
  const { width, height, instruments } = frame;
  const marginX = width * 0.04;
  const marginY = height * 0.04;
  const available = Math.max(0, height - 2 * marginY - 94);
  const rawPitch = available / Math.max(1, instruments.length);
  // When even ten pixels cannot fit, keep every thread visible and use dots.
  const pitch = Math.min(44, rawPitch);
  const labels = Math.min(width * 0.14, 154);
  const left = marginX + labels;
  const top = marginY + 60 + (available - pitch * instruments.length) / 2;
  return {
    left,
    top,
    width: Math.max(1, width - marginX - left),
    height: pitch * instruments.length,
    pitch,
    labels: rawPitch >= 10 && width >= 400,
    marginX,
    marginY,
  };
}

export interface Stitch {
  start: number;
  end: number;
  onset: boolean;
  x: number;
  width: number;
  y: number;
  height: number;
  level: number;
}
export interface Thread {
  id: string;
  y: number;
  stitches: Stitch[];
  maxEnds: number[];
  occupancy?: Float32Array;
  levels?: Float32Array;
  tops?: Float32Array;
}
export interface Cloth {
  box: ReturnType<typeof layout>;
  from: number;
  to: number;
  scale: number;
  threads: Thread[];
}

/** Exact union of covered time in each pixel; overlapping voices never inflate coverage. */
export function occupancy(stitches: Stitch[], left: number, width: number) {
  const count = Math.ceil(width);
  const coverage = new Float32Array(count);
  const levels = new Float32Array(count);
  const tops = new Float32Array(count);
  const edges = stitches.flatMap((stitch) => [
    { x: stitch.x - left, delta: 1, level: stitch.level, top: stitch.y },
    { x: stitch.x + stitch.width - left, delta: -1, level: -stitch.level, top: -stitch.y },
  ]);
  edges.sort((a, b) => a.x - b.x);
  let active = 0;
  let level = 0;
  let top = 0;
  let previous = 0;
  for (const edge of edges) {
    const end = clamp(edge.x, 0, width);
    if (active > 0 && end > previous) {
      for (let i = Math.floor(previous); i < Math.ceil(end); i++) {
        const share = Math.min(end, i + 1) - Math.max(previous, i);
        coverage[i] += share;
        levels[i] += share * clamp(level / active);
        tops[i] += (share * top) / active;
      }
    }
    active += edge.delta;
    level += edge.level;
    top += edge.top;
    previous = end;
  }
  for (let i = 0; i < count; i++) {
    if (coverage[i] > 0) {
      levels[i] /= coverage[i];
      tops[i] /= coverage[i];
    }
  }
  return { coverage, levels, tops };
}

export function buildCloth(frame: ViewFrame): Cloth {
  const box = layout(frame);
  const scale = box.width / Math.max(0.001, frame.to - frame.from);
  const groups = new Map<string, ViewNote[]>();
  for (const note of frame.notes) {
    if (!(note.end > frame.from && note.start < frame.to && note.end > note.start)) continue;
    const group = groups.get(note.instrument);
    if (group) group.push(note);
    else groups.set(note.instrument, [note]);
  }
  const threads = frame.instruments.map((instrument, row): Thread => {
    const notes = groups.get(instrument.id) ?? [];
    const pitches = notes.map((note) => pitch(note.value));
    let lowPitch = Infinity;
    let highPitch = -Infinity;
    let lowGain = Infinity;
    let highGain = -Infinity;
    for (let i = 0; i < notes.length; i++) {
      const p = pitches[i];
      if (p !== undefined) {
        lowPitch = Math.min(lowPitch, p);
        highPitch = Math.max(highPitch, p);
      }
      const gain = notes[i].value.gain;
      if (typeof gain === 'number' && Number.isFinite(gain)) {
        lowGain = Math.min(lowGain, gain);
        highGain = Math.max(highGain, gain);
      }
    }
    const y = box.top + (row + 0.5) * box.pitch;
    const stitches = notes.map((note, index): Stitch => {
      const p = pitches[index];
      const shift =
        p !== undefined && highPitch > lowPitch
          ? ((p - lowPitch) / (highPitch - lowPitch) - 0.5) * box.pitch * -0.32
          : 0;
      const gain = note.value.gain;
      const level =
        typeof gain === 'number' && Number.isFinite(gain)
          ? gain <= 0
            ? 0
            : highGain > lowGain
              ? 0.2 + 0.8 * clamp((gain - lowGain) / (highGain - lowGain))
              : 1
          : 1;
      const start = Math.max(frame.from, note.start);
      const end = Math.min(frame.to, note.end);
      return {
        start: note.start,
        end: note.end,
        onset: note.hasOnset,
        x: box.left + (start - frame.from) * scale,
        width: (end - start) * scale,
        y: y + shift - box.pitch * 0.3,
        height: box.pitch * 0.6,
        level,
      };
    });
    stitches.sort((a, b) => a.start - b.start);
    let maxEnd = -Infinity;
    const maxEnds = stitches.map((stitch) => (maxEnd = Math.max(maxEnd, stitch.end)));
    const dense =
      stitches.length > box.width / 2 ||
      stitches.filter((stitch) => stitch.width < 2).length > Math.max(4, stitches.length / 4);
    const bins = dense ? occupancy(stitches, box.left, box.width) : undefined;
    return {
      id: instrument.id,
      y,
      stitches,
      maxEnds,
      occupancy: bins?.coverage,
      levels: bins?.levels,
      tops: bins?.tops,
    };
  });
  return { box, threads, from: frame.from, to: frame.to, scale };
}

/** End-exclusive spans, indexed backwards with prefix maxima to include long held voices. */
export function activeRange(thread: Thread, now: number, wake = 0) {
  let low = 0;
  let high = thread.stitches.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (thread.stitches[middle].start <= now) low = middle + 1;
    else high = middle;
  }
  let first = low;
  while (first > 0 && thread.maxEnds[first - 1] > now - wake) first--;
  return { first, end: low };
}

function onsetFlash(stitch: Stitch, now: number, cps: number) {
  if (!stitch.onset || now < stitch.start) return 0;
  return Math.pow(clamp(1 - (now - stitch.start) / Math.max(0.0001, cps * 0.15)), 2);
}

export function flash(stitch: Stitch, now: number, cps: number) {
  return now >= stitch.end ? 0 : onsetFlash(stitch, now, cps);
}

export const wakeLength = (trails: ViewFrame['trails']) =>
  trails === 0 ? 0 : trails === 1 ? 0.25 : 1;

/** Fragments can be held, but only an onset-bearing note leaves a hit's afterglow. */
export function stitchLight(stitch: Stitch, now: number, cps: number, wake: number) {
  if (now < stitch.start) return 0;
  const held =
    (0.12 + 0.7 * onsetFlash(stitch, Math.min(now, stitch.end), cps)) * (0.2 + 0.8 * stitch.level);
  if (now < stitch.end) return held;
  return stitch.onset && wake > 0 ? held * clamp(1 - (now - stitch.end) / wake) : 0;
}
