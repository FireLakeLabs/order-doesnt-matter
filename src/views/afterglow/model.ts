import type { ViewFrame, ViewNote, ViewTheme } from '../types';
import { pitch } from '../shared/pitch';
import { clamp } from '../shared/math';

export const LOW_HZ = 20;
export const HIGH_HZ = 20000;
export const BANDS = 96;
export const COLUMNS_PER_CYCLE = 64;
export const MAX_COLUMNS = 4096;
export const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const frequencyPosition = (hz: number) =>
  clamp(Math.log(hz / LOW_HZ) / Math.log(HIGH_HZ / LOW_HZ));
/** Web Audio's default byte FFT range is -100…-30 dBFS. Display -90…-30. */
export const decibels = (byte: number) => -100 + (byte / 255) * 70;
export const level = (byte: number) => clamp((decibels(byte) + 90) / 60);

/** Same sample-rate inference as Scope: the tap's wave is exactly 100 ms.
 * Peak bin per log band; no interpolation between bins or measured times. */
export function spectrumBands(audio: NonNullable<ViewFrame['audio']>): Uint8Array {
  const result = new Uint8Array(BANDS);
  const resolution = audio.wave.length / 0.1 / (audio.spectrum.length * 2);
  if (!Number.isFinite(resolution) || resolution <= 0) return result;
  for (let band = 0; band < BANDS; band++) {
    const low = LOW_HZ * 1000 ** (band / BANDS);
    const high = LOW_HZ * 1000 ** ((band + 1) / BANDS);
    const from = Math.max(1, Math.ceil(low / resolution));
    const to = Math.max(from + 1, Math.ceil(high / resolution));
    for (let bin = from; bin < Math.min(to, audio.spectrum.length); bin++)
      result[band] = Math.max(result[band], audio.spectrum[bin]);
  }
  return result;
}

export interface Column {
  time: number;
  pass: number;
  bands: Uint8Array;
}
/** One actual snapshot per 1/64-cycle cell per observed pass. Missing
 * cells stay missing, including seeks and throttled RAFs. FIFO bounds memory.
 * This is an observation store, never a clock or a playback simulation. */
export class HeardColumns {
  readonly columns = new Map<number, Column>();
  private settings: ViewFrame['instruments'][number]['settings'][] = [];
  private ids = '';
  pass = 0;
  lastObservedNow = -Infinity;
  observe(frame: ViewFrame) {
    const ids = frame.instruments.map((i) => i.id).join('\0');
    // The host caches settings arrays per immutable document. Their identity
    // changes on *every* program edit, even rhythm/source edits with equal facts.
    // Time, score-window refreshes, themes and resizing do not change them.
    if (ids !== this.ids || frame.instruments.some((i, n) => i.settings !== this.settings[n])) {
      this.clear();
      this.ids = ids;
      this.settings = frame.instruments.map((i) => i.settings);
    }
    if (!frame.playing || !frame.audio || !Number.isFinite(frame.now)) return;
    // A pass is observation provenance, derived only from real audio arriving
    // at a lower score time (a loop wrap or seek). It never advances time.
    if (frame.now < this.lastObservedNow) this.pass++;
    const key = Math.floor(frame.now * COLUMNS_PER_CYCLE);
    const previous = this.columns.get(key);
    if (!previous || previous.pass < this.pass) {
      this.columns.delete(key);
      this.columns.set(key, {
        time: frame.now,
        pass: this.pass,
        bands: spectrumBands(frame.audio),
      });
      if (this.columns.size > MAX_COLUMNS) {
        const oldest = this.columns.keys().next().value;
        if (oldest !== undefined) this.columns.delete(oldest);
      }
    }
    this.lastObservedNow = frame.now;
  }
  clear() {
    this.columns.clear();
    this.pass = 0;
    this.lastObservedNow = -Infinity;
    this.settings = [];
    this.ids = '';
  }
}

export function timeRange(frame: Pick<ViewFrame, 'now' | 'lookAhead'>) {
  const span = Math.max(1, frame.lookAhead);
  return { from: frame.now - span * 0.75, to: frame.now + span * 0.25 };
}
/** Actual visible observation cells only: gaps remain hatch, and no cell can
 * reveal heat after now, including a cell straddling the playhead. */
export function visibleColumns(
  heard: HeardColumns,
  range: { from: number; to: number },
  now: number,
) {
  const columns: { column: Column; from: number; to: number }[] = [];
  let earlierPass = false;
  for (const [cell, column] of heard.columns) {
    const from = Math.max(range.from, cell / COLUMNS_PER_CYCLE);
    const to = Math.min(range.to, now, (cell + 1) / COLUMNS_PER_CYCLE);
    if (column.time > now || to <= from) continue;
    columns.push({ column, from, to });
    earlierPass ||= column.pass < heard.pass;
  }
  return {
    columns,
    earlierPass: columns.length > 0 && (earlierPass || now < heard.lastObservedNow),
  };
}

export function scoredNotes(frame: ViewFrame) {
  const { from, to } = timeRange(frame);
  interface Scored {
    note: ViewNote;
    hz: number | undefined;
  }
  const groups = new Map<string, { onsets: Scored[]; carried?: Scored }>();
  for (const note of frame.notes) {
    if (note.end <= from || note.start >= to) continue;
    // Strudel sample n selects a sample; scaled n already arrives as note.
    const midi = pitch({ ...note.value, n: undefined });
    const tone = { note, hz: midi === undefined ? undefined : frequency(midi) };
    const key = JSON.stringify([note.instrument, note.start, note.end, midi]);
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { onsets: [] }));
    if (note.hasOnset) group.onsets.push(tone);
    else group.carried ??= tone;
  }
  // Repeated whole-span fragments continue one note. Real coincident onsets
  // stay counted even when their outlines share the same pixels.
  return [...groups.values()].flatMap((g) =>
    g.onsets.length ? g.onsets : g.carried ? [g.carried] : [],
  );
}
export function layout(width: number, height: number) {
  const left = 58,
    right = width - 18,
    top = 86;
  const bottom = Math.max(top + 12, height - 118);
  return { left, right, top, bottom, floor: bottom + 12, floorHeight: 36 };
}
export function noteGeometry(note: ViewNote, hz: number | undefined, frame: ViewFrame) {
  const box = layout(frame.width, frame.height),
    range = timeRange(frame);
  const x = (time: number) =>
    box.left + ((time - range.from) / (range.to - range.from)) * (box.right - box.left);
  const instrument = frame.instruments.find((i) => i.id === note.instrument);
  const y =
    hz === undefined
      ? box.floor + ((instrument?.index ?? 0) % 4) * 9 + 1
      : box.bottom - frequencyPosition(hz) * (box.bottom - box.top) - 3;
  return {
    x: x(Math.max(range.from, note.start)),
    end: x(Math.min(range.to, note.end)),
    y,
    height: 6,
  };
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) =>
  rgb(hex).reduce((sum, c, i) => {
    const s = c / 255;
    return (
      sum + (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]
    );
  }, 0);
/** Level always increases brightness. Light themes reserve their paper colours
 * for the unmeasured background; measured heat ends in a signal colour. */
export function heatRamp(theme: ViewTheme) {
  const colours =
    luminance(theme.ground) > luminance(theme.text)
      ? [theme.text, theme.muted, theme.accent]
      : [theme.ground, theme.panel, theme.accent, theme.text];
  const stops = [...new Set(colours)].sort((a, b) => luminance(a) - luminance(b));
  return Array.from({ length: 256 }, (_, index) => {
    const position = (index / 255) * (stops.length - 1);
    const a = rgb(stops[Math.floor(position)]),
      b = rgb(stops[Math.min(stops.length - 1, Math.floor(position) + 1)]);
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * (position % 1))).join(',')})`;
  });
}
