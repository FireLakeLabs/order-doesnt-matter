import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { clamp, pitch } from '../shared/retro-2d';

export { pitch };
export const ROAD_LENGTH = 96;
export const PLAYHEAD_Z = -1;
export const roadZ = (time: number, now: number, lookAhead: number) =>
  PLAYHEAD_Z - ((time - now) * ROAD_LENGTH) / Math.max(0.001, lookAhead);
export function hitFlash(note: ViewNote, now: number, cps: number) {
  return note.hasOnset && now >= note.start
    ? clamp(1 - (now - note.start) / (Math.max(0.001, cps) * 0.15))
    : 0;
}
export type Role = 'gates' | 'posts' | 'lane' | 'lights';
export interface RoadVoice {
  instrument: ViewInstrument;
  notes: ViewNote[];
  role: Role;
  slot: number;
  dense: boolean;
}
/** Names and sound identifiers are deliberately absent from the decision. */
export function roadVoices(frame: Pick<ViewFrame, 'notes' | 'instruments'>): RoadVoice[] {
  const grouped = new Map<string, ViewNote[]>();
  for (const note of frame.notes) {
    const group = grouped.get(note.instrument) ?? [];
    group.push(note);
    grouped.set(note.instrument, group);
  }
  const voices = frame.instruments
    .filter((i) => i.inSection)
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((instrument, slot) => {
      const notes = (grouped.get(instrument.id) ?? []).slice().sort((a, b) => a.start - b.start);
      return { instrument, notes, role: 'lights' as Role, slot, dense: false };
    });
  const drums = voices.flatMap((voice) => {
    const starts = [
      ...new Set(
        voice.notes.filter((n) => n.hasOnset && pitch(n.value) === undefined).map((n) => n.start),
      ),
    ];
    if (!starts.length) return [];
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    const mean = gaps.reduce((sum, n) => sum + n, 0) / Math.max(1, gaps.length);
    const variation = gaps.reduce((sum, n) => sum + (n - mean) ** 2, 0) / Math.max(1, gaps.length);
    const density = mean > 0 ? 1 / mean : 1;
    voice.dense = density > 128;
    const downbeats =
      starts.filter((t) => Math.abs(t - Math.round(t)) < 1e-6).length / starts.length;
    const regularity = mean ? Math.round((Math.sqrt(variation) / mean) * 1e6) / 1e6 : 1;
    return [{ voice, density, regularity, downbeats }];
  });
  const regular = drums
    .slice()
    .sort(
      (a, b) =>
        a.regularity - b.regularity ||
        b.downbeats - a.downbeats ||
        a.density - b.density ||
        a.voice.slot - b.voice.slot,
    );
  const gate = regular.at(0);
  if (gate) gate.voice.role = 'gates';
  const remaining = drums.filter((d) => d !== gate);
  const dense = remaining
    .slice()
    .sort((a, b) => b.density - a.density || a.voice.slot - b.voice.slot)
    .at(0);
  for (const drum of remaining)
    drum.voice.role = drum === dense && drum.density >= 4 ? 'lane' : 'posts';
  // Pitched floods also become occupancy, with every span represented.
  for (const voice of voices) {
    const from = voice.notes[0]?.start ?? 0;
    const to = voice.notes.reduce((end, n) => Math.max(end, n.end), from + 1);
    voice.dense ||= voice.notes.length / Math.max(1, to - from) > 128;
  }
  return voices;
}

export interface HillDriver {
  instrument: string;
  name: string;
  setting: string;
  min: number;
  max: number;
  samples: { start: number; end: number; value: number }[];
}
const identity = new Set([
  'note',
  'n',
  'freq',
  's',
  'sound',
  'orbit',
  'begin',
  'end',
  'unit',
  'cps',
  'cycle',
  'duration',
]);
/** Compare dimensionless variance and changes, so a large unit (Hz) cannot win by itself. */
export function hillDriver(voices: RoadVoice[]): HillDriver | undefined {
  let winner: HillDriver | undefined;
  let best = 0;
  for (const voice of voices) {
    if (voice.instrument.muted) continue;
    const settings = new Set(voice.notes.flatMap((n) => Object.keys(n.value)));
    for (const setting of settings) {
      if (identity.has(setting)) continue;
      const samples = voice.notes.flatMap((n) => {
        const value = n.value[setting];
        return typeof value === 'number' && Number.isFinite(value)
          ? [{ start: n.start, end: n.end, value }]
          : [];
      });
      if (samples.length < 2) continue;
      const min = Math.min(...samples.map((s) => s.value));
      const max = Math.max(...samples.map((s) => s.value));
      if (max === min) continue;
      const values = samples.map((s) => (s.value - min) / (max - min));
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      const changes =
        values.slice(1).filter((v, i) => v !== values[i]).length / (values.length - 1);
      const score = variance * changes;
      if (score > best) {
        best = score;
        winner = {
          instrument: voice.instrument.id,
          name: voice.instrument.name,
          setting,
          min,
          max,
          samples,
        };
      }
    }
  }
  return winner;
}
/** A value belongs to a whole note. Gaps hold the last value; there is no within-note oscillator. */
export function hillHeight(driver: HillDriver | undefined, time: number) {
  if (!driver) return 2;
  let value = driver.samples[0].value;
  for (const sample of driver.samples) {
    if (sample.start > time) break;
    value = sample.value;
  }
  return 1 + 6 * clamp((value - driver.min) / (driver.max - driver.min));
}
export function hillProfile(driver: HillDriver | undefined, from: number, to: number) {
  const result = [{ time: from, height: hillHeight(driver, from) }];
  if (driver)
    for (const sample of driver.samples) {
      if (sample.start <= from || sample.start >= to) continue;
      const height = 1 + 6 * clamp((sample.value - driver.min) / (driver.max - driver.min));
      const previous = result[result.length - 1];
      result.push({ time: sample.start, height: previous.height }, { time: sample.start, height });
    }
  result.push({ time: to, height: result[result.length - 1].height });
  return result;
}
export interface RoadMark {
  start: number;
  end: number;
  onset: boolean;
  pitch?: number;
  count: number;
}
/** Occupancy bins cover every occupied span and retain a count, including subpixel floods. */
export function roadMarks(voice: RoadVoice, from = -Infinity, to = Infinity): RoadMark[] {
  const notes = voice.notes.filter(
    (n) => n.end > from && n.start < to && (n.hasOnset || pitch(n.value) !== undefined),
  );
  if (!voice.dense)
    return notes.map((n) => ({
      start: n.start,
      end: n.end,
      onset: n.hasOnset,
      pitch: pitch(n.value),
      count: 1,
    }));
  const bins = new Map<number, RoadMark>();
  for (const note of notes) {
    const first = Math.max(Math.floor(from * 128), Math.floor(note.start * 128));
    const last = Math.min(Math.ceil(to * 128) - 1, Math.max(first, Math.ceil(note.end * 128) - 1));
    for (let bin = first; bin <= last; bin++) {
      const existing = bins.get(bin);
      if (existing) existing.count++;
      else
        bins.set(bin, {
          start: bin / 128,
          end: (bin + 1) / 128,
          onset: false,
          pitch: pitch(note.value),
          count: 1,
        });
    }
  }
  return [...bins.values()];
}
export function sectionRoad(frame: Pick<ViewFrame, 'sections' | 'now' | 'lookAhead'>) {
  const length = frame.sections.at(-1)?.to ?? 0;
  if (!length) return { current: undefined, progress: ((frame.now % 1) + 1) % 1, ahead: [] };
  const offset = Math.floor(frame.now / length) * length;
  const current = frame.sections.find(
    (s) => s.from + offset <= frame.now && s.to + offset > frame.now,
  );
  const ahead: { name: string; time: number }[] = [];
  for (let loop = 0; loop <= Math.ceil(frame.lookAhead / length) + 1; loop++)
    for (const section of frame.sections) {
      const time = offset + loop * length + section.from;
      if (time > frame.now && time <= frame.now + frame.lookAhead)
        ahead.push({ name: section.name, time });
    }
  return {
    current,
    progress: current ? (frame.now - offset - current.from) / (current.to - current.from) : 0,
    ahead,
  };
}
