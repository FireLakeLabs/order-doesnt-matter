// Wave 1 contract. Types only: the seams between import/generate, the engine and
// the score sheet. Change it only through the lead; say so in your pull request.
import type { Doc } from './document';
import type { PlainEvent } from './strudel';

/* ---- Import and generate: src/import/, src/generate/ ---- */

export interface ImportWarning {
  message: string;
  /** Offsets into the imported source. */
  span?: { start: number; end: number };
  nodeId?: string;
}
export interface ImportResult {
  doc: Doc;
  warnings: ImportWarning[];
}
/** Never drops code (D3). Throws only when the source is not parseable JavaScript. */
export type ImportStrudel = (source: string) => ImportResult;

export interface GenerateOptions {
  /**
   * Generate the whole piece with other instruments silenced in place. Accepts
   * an id from instruments(doc), preserving arrangement timing, use-site layers,
   * setup, tempo and global transforms. A voice id still isolates that voice.
   * This is how a row of the sheet gets its own events.
   */
  only?: string;
}
/** Fresh Strudel that plays the document (D2). Pure and synchronous. */
export type Generate = (doc: Doc, options?: GenerateOptions) => string;

/* ---- Asking what happens: src/strudel/evaluate.ts ---- */

export interface EventResult {
  events: PlainEvent[];
  /** Cycles per second after the program's own tempo calls. */
  cps: number;
  /** Broken is not quiet: a failed question is an error, never an empty list. */
  error: null | { message: string; phase: 'evaluation' | 'query' | 'timeout' };
  /** True when an event value held a function or cycle the comparison cannot see into. */
  opaqueValues: boolean;
}
/** Evaluates Strudel source without audio and lists events in [fromCycle, toCycle). */
export type QueryEvents = (
  code: string,
  fromCycle: number,
  toCycle: number,
) => Promise<EventResult>;

/* ---- Engine: src/engine/, src/strudel/audio.ts ---- */

export interface SoundState {
  /** The sound name as written, e.g. `bd` or `sawtooth`. */
  name: string;
  state: 'loading' | 'ready' | 'missing';
  /** Why it is missing, in words a musician can act on. */
  detail?: string;
}
export type EngineEvent =
  | { type: 'transport'; playing: boolean }
  | { type: 'sounds'; sounds: SoundState[] }
  /** A note was handed to the audio engine. `time` is audio-clock seconds. */
  | { type: 'trigger'; value: unknown; cycle: number; time: number }
  /** The first trigger scheduled from the code given to the latest `play` call. */
  | { type: 'swapped'; revision: number; cycle: number; time: number }
  /** The latest play revision was queried for a scheduler window with no onsets.
   * `cycle` and audio-clock `time` mark that window's start, not permanent silence.
   * A later first trigger may still report `swapped` for the same revision. */
  | { type: 'committed'; revision: number; cycle: number; time: number }
  | { type: 'error'; message: string };

/** Measured output, for checks. Nothing here says how anything sounds. */
export interface OutputTap {
  /** Stereo RMS of rendered output between two audio-clock times, in seconds. */
  rms(fromTime: number, toTime: number): Promise<number>;
  sampleRate: number;
}
export interface Engine {
  /**
   * Plays generated Strudel. Called while playing, it swaps without stopping and
   * resolves with the revision number later reported by `swapped` or `committed`.
   */
  play(
    code: string,
    options?: {
      fromCycle?: number;
      /** Section starts: discover two cycles at each of the first 32 (64 extra cycles). */
      discoverCycles?: number[];
    },
  ): Promise<number>;
  stop(): void;
  readonly playing: boolean;
  /** Playhead in cycles, or null when stopped. */
  now(): number | null;
  /** Audio-clock time in seconds. */
  audioTime(): number;
  /** Every sound the current code uses, with its state (D12). */
  sounds(): SoundState[];
  subscribe(listener: (event: EngineEvent) => void): () => void;
  tap(): OutputTap;
}
export type CreateEngine = () => Promise<Engine>;

/* ---- Score sheet: src/sheet/ ---- */

/** A sheet can exist before the gesture that creates the audio engine. */
export type SheetSoundState = Omit<SoundState, 'state'> & {
  state: SoundState['state'] | 'not-loaded';
};

export interface SheetInput {
  doc: Doc;
  /** The window of cycles the cells are drawn from. */
  fromCycle: number;
  toCycle: number;
  /** Events per instrument, keyed by `instruments(doc)` id, from `generate({ only })`. */
  events: Record<string, EventResult>;
  sounds: SheetSoundState[];
  playhead: number | null;
}
