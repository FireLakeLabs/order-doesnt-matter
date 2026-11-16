import type { ViewFrame, ViewInstrument, ViewNote, ViewSetting } from '../types';

export const TAU = Math.PI * 2;
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Moon {
  x: number;
  y: number;
  radius: number;
  setting: ViewSetting;
  label: string;
  box: Box;
}
export interface Disc {
  instrument: ViewInstrument;
  x: number;
  y: number;
  radius: number;
  cell: Box;
  moons: Moon[];
}
export interface Layout {
  discs: Disc[];
  resting: ViewInstrument[];
  rest: Box;
  dense: boolean;
  detail: Box;
}
export const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const inside = (a: Box, b: Box) =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
export const visibleSettings = (instrument: ViewInstrument) =>
  instrument.settings.filter(
    (setting) => !['note', 'n', 'freq', 's', 'orbit'].includes(setting.name),
  );

/** Labels own rectangles before painting; each cell owns its entire solar system. */
export function moons(disc: Omit<Disc, 'moons'>, measure: (text: string) => number): Moon[] {
  const result: Moon[] = [];
  const occupied: Box[] = [
    {
      x: disc.x - disc.radius - 5,
      y: disc.y - disc.radius - 5,
      w: disc.radius * 2 + 10,
      h: disc.radius * 2 + 10,
    },
    {
      x: disc.x - Math.min(disc.cell.w - 8, measure(disc.instrument.name)) / 2,
      y: disc.y + disc.radius + 10,
      w: Math.min(disc.cell.w - 8, measure(disc.instrument.name)),
      h: 20,
    },
  ];
  const settings = visibleSettings(disc.instrument);
  const baseRadius = settings.length > 6 ? 9 : 11;
  for (const [index, setting] of settings.entries()) {
    const radius =
      setting.kind === 'signal' || setting.kind === 'values'
        ? Math.min(12, baseRadius + 1)
        : baseRadius;
    let placed: Moon | undefined;
    const initial = setting.label
      .split(/[^\w]+/)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
    for (const label of [setting.label, initial, '']) {
      if (placed) break;
      for (let step = 0; step < 80; step++) {
        const angle = -Math.PI / 2 + ((index / settings.length + step / 80) % 1) * TAU;
        const orbit = disc.radius + 30 + Math.floor(step / 40) * 22;
        const x = disc.x + Math.cos(angle) * orbit,
          y = disc.y + Math.sin(angle) * orbit;
        const left = Math.cos(angle) < -0.15;
        const width = label ? measure(label) : 0;
        const box = {
          x: left ? x - radius - 6 - width : x - radius,
          y: y - radius - 2,
          w: radius * 2 + (label ? width + 6 : 0),
          h: radius * 2 + 4,
        };
        if (!inside(box, disc.cell) || occupied.some((other) => overlap(box, other))) continue;
        placed = { x, y, radius, setting, label, box };
        occupied.push(box);
        break;
      }
    }
    if (placed) result.push(placed);
  }
  return result;
}

/** Same document, section and dimensions always give the same layout. No simulation. */
export function layout(frame: ViewFrame, measure: (text: string) => number): Layout {
  const resting = frame.instruments.filter((i) => !i.inSection);
  const roomOf = (instrument: ViewInstrument) =>
    frame.rooms.find((room) => room.members.includes(instrument.id))?.orbit ??
    Number.MAX_SAFE_INTEGER;
  const active = frame.instruments
    .filter((i) => i.inSection)
    .sort((a, b) => roomOf(a) - roomOf(b) || a.index - b.index);
  const dense = frame.instruments.length >= 20;
  const side = frame.width >= 900 && resting.length > 0;
  const restHeight = resting.length && !side ? 42 + Math.ceil(resting.length / 3) * 22 : 0;
  const rest: Box = side
    ? { x: frame.width - 176, y: 60, w: 164, h: frame.height - 100 }
    : { x: 20, y: frame.height - restHeight - 22, w: frame.width - 40, h: restHeight };
  const detail: Box = {
    x: 16,
    y: frame.height - restHeight - 250,
    w: frame.width - (side ? 208 : 32),
    h: 210,
  };
  const area = {
    x: 18,
    y: 55,
    w: frame.width - (side ? 212 : 36),
    h: frame.height - 100 - restHeight - (dense ? 235 : 0),
  };
  const count = active.length;
  const cols = Math.max(1, Math.round(Math.sqrt((count * area.w) / Math.max(1, area.h))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const w = area.w / cols,
    h = area.h / rows;
  const section = frame.sections.find((s) => {
    const length = frame.sections.at(-1)?.to ?? 1;
    const phase = ((frame.now % length) + length) % length;
    return phase >= s.from && phase < s.to;
  });
  const duration = new Map<string, number>();
  const length = frame.sections.at(-1)?.to ?? 0;
  const repeat = length ? Math.floor(frame.now / length) * length : 0;
  const from = section ? repeat + section.from : Math.floor(frame.now / 4) * 4;
  const to = section ? repeat + section.to : from + 4;
  for (const note of frame.notes) {
    const span = Math.max(0, Math.min(to, note.end) - Math.max(from, note.start));
    duration.set(note.instrument, (duration.get(note.instrument) ?? 0) + span);
  }
  const smaller = Math.min(frame.width, frame.height);
  const discs = active.map((instrument, index): Disc => {
    const cell = {
      x: area.x + (index % cols) * w + 4,
      y: area.y + Math.floor(index / cols) * h + 4,
      w: w - 8,
      h: h - 8,
    };
    const ratio = Math.min(1, (duration.get(instrument.id) ?? 0) / (to - from));
    const radius = Math.max(
      smaller * 0.04,
      Math.min(smaller * (0.04 + 0.05 * ratio), w * 0.22, h * 0.25),
    );
    const disc = {
      instrument,
      x: cell.x + cell.w / 2,
      y: cell.y + cell.h / 2 - 6,
      radius,
      cell,
      moons: [] as Moon[],
    };
    if (!dense) disc.moons = moons(disc, measure);
    return disc;
  });
  return { discs, resting, rest, dense, detail };
}

export function pulse(notes: ViewNote[], now: number, cps: number): number {
  let light = 0;
  for (const note of notes) {
    if (!note.hasOnset || note.start > now) continue;
    light = Math.max(light, Math.max(0, 1 - (now - note.start) / Math.max(cps, 0.001) / 0.22));
  }
  return light;
}
export function settingValue(note: ViewNote | undefined, name: string): unknown {
  return (
    note?.value[name] ??
    note?.value[{ lpf: 'cutoff', hpf: 'hcutoff', roomsize: 'size', resonance: 'lpq' }[name] ?? name]
  );
}
/** Sampled values stay fixed throughout the note; only the next note changes the light. */
export function brightness(notes: ViewNote[], setting: ViewSetting, now: number): number {
  const active = (note: ViewNote) => note.start <= now && note.end > now;
  const current = notes.findLast((note) => note.hasOnset && active(note)) ?? notes.findLast(active);
  const onsets = notes.filter((note) => note.hasOnset);
  const value = settingValue(current, setting.name);
  const numeric = (onsets.length ? onsets : notes)
    .map((note) => settingValue(note, setting.name))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (typeof value !== 'number' || !numeric.length) return current ? 0.8 : 0.2;
  const low = Math.min(...numeric),
    high = Math.max(...numeric);
  return high - low < Math.max(1, Math.abs(high)) * 1e-9
    ? 0.8
    : 0.25 + (0.75 * (value - low)) / (high - low);
}
/** Every span contributes to occupancy; dense rhythms never lose hits to a draw cap. */
export function rhythm(notes: ViewNote[], cycle: number, bins = 256): Float32Array {
  const result = new Float32Array(bins);
  for (const note of notes) {
    const from = Math.max(0, note.start - cycle),
      to = Math.min(1, note.end - cycle);
    if (to <= from) continue;
    for (let i = Math.floor(from * bins); i < Math.ceil(to * bins); i++)
      result[i] = Math.min(
        1,
        result[i] + (Math.min(to, (i + 1) / bins) - Math.max(from, i / bins)) * bins,
      );
  }
  return result;
}
