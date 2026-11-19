import type { SampleBuffer, SampleResult } from '../../strudel/sample-buffers';
import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { clamp } from '../shared/math';

const number = (value: unknown, fallback: number) =>
  value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
export interface Pad {
  key: string;
  sound: string;
  index: number;
  parts: ViewInstrument[];
  notes: ViewNote[];
  result: SampleResult;
}
/** Window inventory plus constant settings for parts absent from this question.
 * No remembered inventory: identical frames always produce identical pads. */
export function samplePads(frame: ViewFrame): Pad[] {
  const pads = new Map<string, Pad>();
  const add = (part: ViewInstrument, value: ViewNote['value'], note?: ViewNote) => {
    // Superdough 1.3.0's default source is triangle when an event omits s.
    const sound =
      typeof value.s === 'string' ? value.s : note && value.s === undefined ? 'triangle' : '';
    const bank = typeof value.bank === 'string' ? `${value.bank}_` : '';
    const index = Math.round(number(value.n, 0));
    const pitch: { note?: string | number; freq?: number } = {};
    if (typeof value.note === 'string' || typeof value.note === 'number') pitch.note = value.note;
    if (typeof value.freq === 'number') pitch.freq = value.freq;
    // Pitch is part of a source address: note-keyed banks can select another file.
    const key = JSON.stringify([bank + sound, index, pitch]);
    let pad = pads.get(key);
    if (!pad) {
      pad = {
        key,
        sound: bank + sound,
        index,
        parts: [],
        notes: [],
        result: sound
          ? (frame.samples?.get(bank + sound, index, pitch) ?? { status: 'loading' })
          : { status: 'unavailable', reason: 'No sample address in score' },
      };
      pads.set(key, pad);
    }
    if (!pad.parts.some((p) => p.id === part.id)) pad.parts.push(part);
    if (note) pad.notes.push(note);
  };
  for (const part of [...frame.instruments].sort((a, b) => a.index - b.index)) {
    const notes = frame.notes.filter((note) => note.instrument === part.id);
    for (const note of notes) add(part, note.value, note);
    if (!notes.length) {
      const constants = Object.fromEntries(
        part.settings.filter((s) => s.kind === 'constant').map((s) => [s.name, s.value]),
      );
      if (typeof constants.s === 'string') add(part, constants);
    }
  }
  // Merge voices that resolve to the same source file (and synth pitches into one card).
  const result = new Map<string, Pad>();
  for (const pad of pads.values()) {
    const key = JSON.stringify([
      pad.sound,
      pad.result.status === 'synth' ? null : pad.index,
      pad.result.status === 'buffer' ? pad.result.url : pad.result.status,
    ]);
    const previous = result.get(key);
    if (!previous) result.set(key, { ...pad, key });
    else {
      previous.notes.push(...pad.notes);
      for (const part of pad.parts)
        if (!previous.parts.some((p) => p.id === part.id)) previous.parts.push(part);
    }
  }
  return [...result.values()].sort(
    (a, b) => a.parts[0].index - b.parts[0].index || a.key.localeCompare(b.key),
  );
}
export interface Cursor {
  note: ViewNote;
  begin: number; // source PCM fractions, after reversal mapping
  end: number;
  position: number;
  fraction: number; // elapsed fraction of the played slice, in playback order
  age: number; // seconds since onset
  speed: number;
  ended: boolean;
  limited: boolean;
}
/** Superdough 1.3.0 sampler.mjs: source frames travelled =
 * (now - onset) * speed * (sampleRate / cps). Divide by frameCount
 * for source fraction. cps is the transport's playback rate (cycles/second),
 * NOT AudioBufferSourceNode.playbackRate. unit 'c' additionally multiplies
 * speed by buffer.duration; pinned Superdough treats 's' like ordinary rate.
 * begin/end scale the NATURAL buffer, independently of speed. Negative speed
 * reverses the ENTIRE PCM first, so [b,e] maps to [1-e,1-b] in our source screen.
 * The lookup doesn't expose bank-root transposition or detune automation. Such
 * explicit-pitch notes keep real waveforms/bounds without an exact cursor. A
 * note-keyed bank can also transpose the implicit MIDI 36; that case is not
 * detectable from this lookup (see README limits).
 * This is source traversal, not measured output: envelopes, cut groups and FX
 * aren't inferred. Only onset-bearing notes in the supplied window trigger. */
export function sampleCursor(
  note: ViewNote,
  buffer: SampleBuffer,
  now: number,
  cps: number,
): Cursor {
  const speed = number(note.value.speed, 1);
  const b = clamp(number(note.value.begin, 0)),
    e = clamp(number(note.value.end, 1));
  const begin = speed < 0 ? 1 - e : b;
  const end = speed < 0 ? 1 - b : e;
  const age = Math.max(0, now - note.start) / Math.max(Number.EPSILON, cps);
  const rate = Math.abs(speed) * (note.value.unit === 'c' ? buffer.duration : 1);
  const length = Math.max(0, e - b);
  const fraction = length > 0 ? clamp((age * rate) / (buffer.duration * length)) : 1;
  const limited = ['note', 'freq', 'accelerate', 'vib', 'vibmod', 'penv', 'loop'].some(
    (key) => note.value[key] !== undefined,
  );
  return {
    note,
    begin,
    end,
    age,
    speed,
    fraction,
    position: speed < 0 ? end - fraction * length : begin + fraction * length,
    ended: fraction >= 1 || speed === 0,
    limited,
  };
}
export function padState(pad: Pad, frame: ViewFrame) {
  const eligible = new Set(pad.parts.filter((p) => p.inSection && !p.muted).map((p) => p.id));
  const muted =
    (pad.parts.some((p) => p.inSection) && !eligible.size) || pad.parts.every((p) => p.muted);
  const hits = pad.notes.filter(
    (n) => n.hasOnset && n.start <= frame.now && eligible.has(n.instrument),
  );
  const latest = hits.reduce<ViewNote | undefined>(
    (last, n) => (!last || n.start > last.start ? n : last),
    undefined,
  );
  const light = latest
    ? Math.exp((-Math.max(0, frame.now - latest.start) / Math.max(frame.cps, 1e-9)) * 7)
    : 0;
  const result = pad.result;
  const cursors =
    result.status === 'buffer'
      ? hits.map((n) => sampleCursor(n, result, frame.now, frame.cps))
      : [];
  const active = cursors.filter((c) => !c.ended && !c.limited);
  return { hits, latest, light, cursors, active, muted, resting: !eligible.size };
}

/** Collapse only shared peak summaries, never source channels/PCM. Memoized by
 * immutable buffer identity and screen resolution; frames only draw the bins. */
const summaries = new WeakMap<
  SampleBuffer,
  { columns: number; min: Float32Array; max: Float32Array }
>();
export function waveformPeaks(buffer: SampleBuffer, columns: number) {
  columns = Math.max(1, Math.floor(columns));
  const cached = summaries.get(buffer);
  if (cached?.columns === columns) return cached;
  const min = new Float32Array(columns),
    max = new Float32Array(columns);
  for (let x = 0; x < columns; x++) {
    let lo = Infinity,
      hi = -Infinity;
    const from = Math.floor(((x / columns) * buffer.frameCount) / buffer.peaks.blockSize);
    const to = Math.ceil((((x + 1) / columns) * buffer.frameCount) / buffer.peaks.blockSize);
    for (const channel of buffer.peaks.channels)
      for (let i = from; i < Math.min(to, channel.min.length); i++) {
        lo = Math.min(lo, channel.min[i]);
        hi = Math.max(hi, channel.max[i]);
      }
    min[x] = Number.isFinite(lo) ? lo : 0;
    max[x] = Number.isFinite(hi) ? hi : 0;
  }
  const summary = { columns, min, max };
  summaries.set(buffer, summary);
  return summary;
}
export function padLayout(count: number, width: number, height: number, synths: number) {
  const gap = 12,
    margin = 18;
  const columns = Math.max(
    1,
    Math.min(Math.max(1, count), 3, Math.floor((width - margin * 2 + gap) / 250)),
  );
  const synthColumns = Math.max(1, Math.min(synths, Math.floor((width - margin * 2 + gap) / 220)));
  const synthRows = Math.min(2, Math.ceil(synths / synthColumns));
  const synthHeight = synthRows ? synthRows * 92 + 20 : 0;
  const available = Math.max(100, height - 80 - synthHeight);
  const rows = Math.max(1, Math.min(Math.ceil(count / columns), Math.floor(available / 128)));
  return {
    columns,
    capacity: rows * columns,
    width: (width - margin * 2 - gap * (columns - 1)) / columns,
    height: available / rows - gap,
    synthY: 48 + available,
    synthColumns,
    synthCapacity: synthRows * synthColumns,
    synthWidth: (width - margin * 2 - gap * (synthColumns - 1)) / synthColumns,
  };
}
