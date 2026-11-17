import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { clamp } from '../shared/math';
import { burst, random, spark, type Particle } from '../shared/particles';
import { pitch } from '../shared/pitch';
import { flightProgress, noteProgress } from '../shared/timing';

interface Event {
  note: ViewNote;
  midi: number | undefined;
  gain: number;
  seed: number;
}
export function indexShells(notes: ViewNote[]) {
  const groups = new Map<string, Event[]>();
  for (const note of notes) {
    const midi = pitch(note.value);
    let seed = 2166136261;
    for (const char of `${note.instrument}/${String(note.start)}/${String(note.end)}/${String(midi)}`)
      seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    const raw = Number(note.value.gain ?? 1);
    const event = { note, midi, seed, gain: Number.isFinite(raw) ? Math.max(0, raw) : 1 };
    const group = groups.get(note.instrument);
    if (group) group.push(event);
    else groups.set(note.instrument, [event]);
  }
  return groups;
}
export interface Shell {
  event: Event;
  instrument: ViewInstrument;
  pad: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  radius: number;
  age: number;
  life: number;
  alpha: number;
  willow: boolean;
  droop: number;
  flight: number;
}
export interface Fountain {
  instrument: ViewInstrument;
  pad: number;
  x: number;
  y: number;
  radius: number;
  alpha: number;
  count: number;
  flying: number;
  bursting: number;
  seed: number;
}
export interface Ring {
  name: string;
  age: number;
  alpha: number;
}
export const sparkCount = 22;
/** Local crowd policy: more than 36 visible shells per pad merge into one counted fountain. */
export function sky(frame: ViewFrame, groups = indexShells(frame.notes)) {
  const shells: Shell[] = [],
    fountains: Fountain[] = [],
    rings: Ring[] = [];
  let flying = 0,
    bursting = 0;
  const floor = frame.height - Math.max(62, frame.height * 0.1);
  const linger = [0.12, 0.45, 1][frame.trails];
  // The host preserves whole scored spans for carry-ins. A signal has only its
  // clipped query span, so it cannot start before frame.from. Never relaunch it.
  const knownOnset = (note: ViewNote) => note.hasOnset || note.start < frame.from;
  // Resting pads return when their first shell enters the launch window. No note is hidden.
  const pads = frame.instruments.filter(
    (instrument) =>
      instrument.inSection ||
      (groups.get(instrument.id) ?? []).some(({ note }) => {
        const duration = Math.max(0, note.end - note.start);
        const life = (duration >= 0.25 ? duration : 0) + linger;
        const age = frame.now - note.start;
        return knownOnset(note) && age >= -frame.lookAhead && age < life;
      }),
  );
  const step = (frame.width * 0.8) / Math.max(1, pads.length);
  pads.forEach((instrument, i) => {
    const pad = frame.width * 0.1 + step * (i + 0.5);
    const visible: Shell[] = [];
    for (const event of groups.get(instrument.id) ?? []) {
      const { note } = event;
      if (!knownOnset(note)) continue;
      const age = frame.now - note.start;
      const duration = Math.max(0, note.end - note.start);
      const willow = duration >= 0.25;
      const life = willow ? duration + linger : linger;
      if (age < -frame.lookAhead || age >= life) continue;
      const phase = ((note.start % 1) + 1) % 1;
      const targetX = pad + (phase - 0.5) * Math.min(step * 0.7, frame.width * 0.075);
      // Absolute pitch keeps a given note at the same height when the queried window changes.
      const targetY =
        frame.height *
        (event.midi === undefined
          ? 0.19 + ((instrument.index * 0.61803398875) % 1) * 0.25
          : 0.17 + 0.5 / (1 + Math.exp((event.midi - 28) / 18)));
      const flight = flightProgress(note, frame.now, frame.lookAhead);
      const alpha =
        age < 0 ? 0.45 + flight * 0.5 : willow && age < duration ? 1 : clamp((life - age) / linger);
      visible.push({
        event,
        instrument,
        pad,
        targetX,
        targetY,
        age,
        life,
        willow,
        flight,
        alpha,
        x: pad + (targetX - pad) * flight,
        y: floor + (targetY - floor) * Math.sin((flight * Math.PI) / 2),
        radius: (((willow ? 150 : 120) * frame.width) / 960) * Math.sqrt(clamp(event.gain, 0, 4)),
        droop: willow
          ? ((200 * frame.width) / 960) * noteProgress(note, frame.now)
          : ((34 * frame.width) / 960) * clamp(age / life),
      });
      if (age < 0) flying++;
      else bursting++;
    }
    if (visible.length <= 36) shells.push(...visible);
    else {
      // Every shell contributes to the position, energy and occupancy of the fountain.
      const count = visible.length;
      fountains.push({
        instrument,
        pad,
        count,
        x: visible.reduce((sum, s) => sum + s.x, 0) / count,
        y: visible.reduce((min, s) => Math.min(min, s.y), floor),
        radius:
          Math.max(8, Math.sqrt(visible.reduce((sum, s) => sum + s.radius * s.radius, 0) / count)) *
          (1 + Math.log2(count) * 0.08),
        alpha: visible.reduce((sum, s) => sum + s.alpha, 0) / count,
        flying: visible.filter((s) => s.age < 0).length,
        bursting: visible.filter((s) => s.age >= 0).length,
        seed: visible.reduce((seed, s) => (seed + s.event.seed) | 0, instrument.index * 7919),
      });
    }
  });
  const length = frame.sections.at(-1)?.to ?? 0;
  if (length > 0)
    for (const section of frame.sections) {
      const iteration = Math.floor((frame.now - section.from) / length);
      const age = frame.now - (section.from + iteration * length);
      if (section.from + iteration * length >= 0 && age >= 0 && age < 0.65)
        rings.push({ name: section.name, age, alpha: 1 - age / 0.65 });
    }
  return { shells, fountains, rings, flying, bursting, floor, pads };
}
/** Endpoint and curve control share the frozen, time-pure radial particle helper. */
export function shellSpark(shell: Shell, index: number) {
  const expansion = 1 - Math.exp(-Math.max(0, shell.age) * 36);
  const p = burst(shell.event.seed + index * 101, expansion * 0.85, { x: 0, y: 0, alpha: 0 });
  // Card-sized shells: normalize the shared radial direction so random speed
  // cannot shrink the whole burst. Expansion still starts at the exact onset.
  const scale = expansion > 0 ? (shell.radius * expansion) / Math.hypot(p.x, p.y) : 0;
  const dx = p.x * scale,
    dy = p.y * scale;
  return {
    x: shell.targetX + dx,
    y: shell.targetY + dy + shell.droop,
    cx: shell.targetX + dx * 0.62,
    cy: shell.targetY + dy * 0.62 - shell.droop * 0.2,
  };
}
export function fountainSpark(f: Fountain, index: number, now: number, floor: number): Particle {
  const age = (((now * 1.4 + random(f.seed, index)) % 1) + 1) % 1;
  const p = spark(f.seed + index * 101, age, { x: 0, y: 0, alpha: 0 });
  return {
    x: f.pad + p.x * f.radius,
    y: floor + p.y * Math.max(30, floor - f.y) * 1.4,
    alpha: (0.2 + p.alpha * 0.8) * f.alpha,
  };
}
