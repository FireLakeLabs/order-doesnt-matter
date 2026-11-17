import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { clamp } from '../shared/math';
import { nextOnset, noteProgress, previousOnset } from '../shared/timing';

/** Coalesce repeated whole carry-ins; ViewNote cannot distinguish identical carried unisons. */
export function indexWords(notes: ViewNote[]) {
  const groups = new Map<string, ViewNote[]>();
  const fragments = new Set<string>();
  for (const note of notes) {
    if (!note.hasOnset) {
      const key = JSON.stringify([
        note.instrument,
        note.start,
        note.end,
        Object.entries(note.value).sort(([a], [b]) => a.localeCompare(b)),
      ]);
      if (fragments.has(key)) continue;
      fragments.add(key);
    }
    let group = groups.get(note.instrument);
    if (!group) groups.set(note.instrument, (group = []));
    group.push(note);
  }
  return groups;
}
export function sectionAt(frame: ViewFrame) {
  const length = frame.sections.at(-1)?.to ?? 0;
  const loop = length > 0 ? Math.floor(frame.now / length) * length : 0;
  const section = frame.sections.find((s) => s.from + loop <= frame.now && frame.now < s.to + loop);
  return section
    ? { name: section.name, from: section.from + loop, to: section.to + loop }
    : { name: 'Free play', from: 0, to: Infinity };
}
const number = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const gain = (note: ViewNote) => clamp(number(note.value.gain, 1), 0, 4);
const aliases: Record<string, string> = { lpf: 'cutoff', hpf: 'hcutoff' };

// Stable units, independent of the query window's extrema. A note's sampled
// setting is fixed: only the typographic settling motion advances after onset.
function slantSample(instrument: ViewInstrument, note: ViewNote | undefined) {
  if (!note) return 0;
  for (const setting of instrument.settings) {
    if (setting.kind !== 'signal' && setting.kind !== 'values') continue;
    if (['note', 'n', 'freq', 's', 'sound'].includes(setting.name)) continue;
    const key = aliases[setting.name] ?? setting.name;
    const value = note.value[key] ?? note.value[setting.name];
    if (typeof value === 'string') {
      let code = 0;
      for (const char of value) code = Math.imul(code, 31) + (char.codePointAt(0) ?? 0);
      return (((code >>> 0) % 1024) / 512 - 1) * 0.24;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const unit =
      key === 'cutoff' || key === 'hcutoff'
        ? Math.log2(Math.max(1, value) / 500) / 3
        : key === 'pan'
          ? (value - 0.5) * 2
          : key === 'gain' || key === 'speed'
            ? value - 1
            : (Math.sign(value) * Math.log2(1 + Math.abs(value))) / 3;
    return Math.tanh(unit) * 0.24;
  }
  return 0;
}
export function wordState(frame: ViewFrame, instrument: ViewInstrument, notes: ViewNote[]) {
  const section = sectionAt(frame);
  const previous = previousOnset(notes, instrument.id, frame.now);
  const next = nextOnset(notes, instrument.id, frame.now);
  let active = 0,
    power = 0,
    stretch = 0,
    pulse = 0,
    hits = 0;
  let held: ViewNote | undefined;
  // Every voice and recent onset contributes, even in a 500-note cycle.
  for (const note of notes) {
    if (!note.hasOnset && note.start >= frame.from) continue;
    if (note.start <= frame.now && frame.now < note.end) {
      active++;
      power += gain(note) ** 2;
      if (!held || note.start > held.start) held = note;
      if (note.end - note.start >= 0.25)
        stretch = Math.max(
          stretch,
          noteProgress({ start: Math.max(note.start, section.from), end: note.end }, frame.now),
        );
    }
    if (!note.hasOnset || note.start < section.from || note.start > frame.now) continue;
    const hit = clamp(1 - (frame.now - note.start) / Math.max(0.001, frame.cps * 0.18));
    pulse += hit;
    if (hit > 0) hits++;
  }
  const sample = held ?? previous ?? next;
  const level = active
    ? Math.sqrt(power)
    : sample
      ? gain(sample)
      : number(instrument.settings.find((s) => s.name === 'gain')?.value, 1);
  const pocket = frame.theme.name === 'pocket';
  const anchor = Math.max(previous?.start ?? held?.start ?? section.from, section.from);
  const settle = clamp((frame.now - anchor) / Math.max(0.001, frame.cps * 0.2));
  return {
    motion: !pocket,
    solid: active > 0 && !instrument.muted,
    active: instrument.muted ? 0 : active,
    hits: instrument.muted ? 0 : hits,
    weight: 300 + Math.round(clamp(level / 2) * 500),
    punch: pocket || instrument.muted ? 0 : clamp(pulse) * 0.16,
    stretch: pocket || instrument.muted ? 1 : 1 + stretch * 0.38,
    slant: pocket || instrument.muted ? 0 : slantSample(instrument, sample) * settle,
    progress: stretch,
  };
}
export function poster(frame: ViewFrame, data = indexWords(frame.notes)) {
  const scale = frame.width / 960;
  const margin = Math.max(16, 24 * scale);
  const top = Math.max(70, 68 * scale);
  const bottom = Math.max(40, 34 * scale);
  const all = [...frame.instruments].sort((a, b) => a.index - b.index);
  const ordered = frame.sections.length ? all.filter((i) => i.inSection) : all;
  const sitOut = frame.sections.length ? all.filter((i) => !i.inSection) : [];
  // Nine or more names share two columns, keeping twenty readable as two tens.
  const columns = ordered.length > 8 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(ordered.length / columns));
  const gap = Math.max(20, 32 * scale);
  const width = (frame.width - 2 * margin - (columns - 1) * gap) / columns;
  const height = Math.max(1, (frame.height - top - bottom) / rows);
  return {
    section: sectionAt(frame),
    sitOut,
    columns,
    words: ordered.map((instrument, i) => ({
      instrument,
      text: instrument.name.toUpperCase(),
      x: margin + Math.floor(i / rows) * (width + gap),
      y: top + (i % rows) * height,
      width,
      height,
      // Width sets the poster's scale; row height supplies the crowd rule.
      fontSize: Math.min((rows < 4 ? 520 / rows : 112) * scale, height * 1.32),
      ...wordState(frame, instrument, data.get(instrument.id) ?? []),
    })),
  };
}
export type PosterWord = ReturnType<typeof poster>['words'][number];

/** Fit long names without truncation; reserve space for the full onset punch. */
export function fitWord(word: PosterWord, textWidth: number, inkHeight: number) {
  const reach = word.stretch * (1 + word.punch);
  const reserve = word.motion ? 1.38 * 1.16 : 1;
  const fit = Math.min(1, (word.width - inkHeight * 0.24 - 8) / Math.max(1, textWidth * reserve));
  const heightFit = Math.min(1, (word.height * 0.99) / Math.max(1, inkHeight * 1.16));
  // Preserve legible proportions on the narrow stage, even for long names.
  const uniform = Math.min(heightFit, Math.max(word.height > 300 ? 0.9 : 0.42, fit / 0.7));
  return {
    scaleX: Math.max(0.01, Math.min(uniform, fit)) * reach,
    scaleY: uniform * (1 + word.punch),
  };
}
