import type { Arg, Core, Layer, Pattern, TopLevel } from '../document/types';
import type { EventResult } from '../contract';
import type { SampleLookup } from '../strudel/sample-buffers';

export interface ViewNote {
  instrument: string; // ViewInstrument.id
  start: number; // absolute cycles
  end: number;
  hasOnset: boolean; // false for a fragment or a continuous signal
  value: Record<string, unknown>; // the note's settings
}
export interface ViewSetting {
  name: string;
  label: string;
  kind: 'constant' | 'values' | 'signal' | 'other';
  value?: number | string;
}
export interface ViewInstrument {
  id: string;
  name: string;
  index: number; // row order
  colour: string; // resolved CSS colour for the current theme
  sounding: boolean;
  inSection: boolean;
  muted: boolean;
  settings: ViewSetting[];
  rewrites: string[];
  room: number | null; // Document orbit when known (default 1); frame.rooms has sampled memberships.
}
export interface ViewTheme {
  name: string;
  ground: string;
  panel: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  fontDisplay: string;
  fontMono: string;
  radius: number;
  glow: boolean;
}
/** Snapshots preserve Strudel's whole/part spans, raw values and query errors.
 * An available answer with result.error is broken, never silence. */
export type ViewSnapshot =
  | { status: 'available'; result: EventResult }
  | { status: 'unavailable'; reason: string };
export interface ViewDriver {
  kind: 'constant' | 'values' | 'signal' | 'opaque';
  time: 'definition';
  /** Detached document structure, including its ordered transformations. */
  pattern: Pattern;
  opaque: string | null;
  /** Driver queried independently at the frame's numeric from/to in definition
   * time, without arrangement, use-site or global score transforms. These spans
   * are not playback positions. Signals retain their continuous event spans. */
  events(): Promise<ViewSnapshot>;
  /** Authored fast/slow operations, inner to outer. Events query each argument
   * independently at the frame's numeric from/to in its own local time, before
   * applying it to the driver. They are not an effective playback rate. Outer
   * driver rewrites that could change this timing make events unavailable. */
  rates: {
    id: string;
    name: 'fast' | 'slow';
    args: Arg[];
    time: 'argument';
    opaque: string | null;
    events(): Promise<ViewSnapshot>;
  }[];
}
export type ViewStructureStep = { id: string; opaque: string | null } & (
  | { kind: 'phrase'; core: Core }
  | { kind: 'setting'; layerId: string; name: string; args: Arg[]; driver: ViewDriver }
  | { kind: 'rewrite'; name: string; args: Arg[] }
  | { kind: 'opaque'; code: string }
);
export interface ViewProgramStructure {
  instrument: string;
  from: number;
  to: number;
  /** Step 0 is the core phrase (Pattern.id). Settings flatten their document
   * layer in stored order and use Setting.id; rewrites use Layer.id.
   * Names, arguments and mini structure are exactly as the document records.
   * This is the definition's chain; step 0 is raw BEFORE the separately exposed
   * context. Snapshots retain arrangement placement and apply that context. */
  steps: ViewStructureStep[];
  /** Construction outside this definition, still applied in EVERY snapshot,
   * including step 0. Uses retain their separate inner-to-outer layer chains;
   * path ids identify the arrangement/reference ancestry. Global all() calls
   * retain their document order. These are detached document nodes. */
  context: {
    uses: { voiceId: string; pathIds: string[]; layers: Layer[] }[];
    transforms: Extract<TopLevel, { kind: 'transform' }>[];
  };
  /** Ask Strudel with this chain truncated after index (inclusive). Opaque
   * prefixes are unavailable with a reason. Lazy, off playback, deduplicated
   * by document revision + step + range. 64 results retained, 32 outstanding;
   * a full queue returns unavailable and may be retried on a later frame.
   * Handles expire on document replacement or view disposal. */
  snapshot(index: number): Promise<ViewSnapshot>;
}
export interface ViewStructureLookup {
  get(instrument: string): ViewProgramStructure | undefined;
}

export interface ViewFrame {
  now: number; // absolute cycles, fractional, already latency-corrected
  playing: boolean;
  cps: number; // cycles per second actually playing (after Speed)
  notes: ViewNote[]; // every note overlapping [from, to]
  from: number;
  to: number; // the stretch of time the host has asked about
  instruments: ViewInstrument[];
  sections: { name: string; from: number; to: number }[]; // empty when none
  rooms: { orbit: number; members: string[] }[];
  lookAhead: number; // the Window control, in cycles
  trails: 0 | 1 | 2;
  theme: ViewTheme;
  width: number;
  height: number;
  dpr: number;
  /** Only for needs: 'audio'. Studio supplies the stereo fields together; they
   * are optional so existing mono-only frame producers remain valid; undefined
   * stereo fields mean no stereo measurement, not silence.
   * Buffers and their containing object are reused: copy to retain a snapshot.
   * PCM is oldest first, round(sampleRate * 0.1) samples (100 ms). left, right
   * and wave cover exactly the same samples; each stereo quantum uses
   * wave = (left + right) / 2, each mono quantum uses left. Absent channels
   * are zero-filled, never duplicated. channels is the maximum input channel
   * count in this span (0 = no input). complete is false for uncaptured samples
   * (including startup padding); those samples are also zero-filled.
   * endTime is the exclusive audio-clock end, already corrected by the same
   * baseLatency + outputLatency as now. If capture delivery falls behind,
   * lagSeconds reports that additional age. Within one transport segment
   * (away from seeks/loop wraps), sample i belongs at
   * now - (lagSeconds + (wave.length - i) / sampleRate) * cps.
   * Local 48 kHz browser fixtures measured onset +0.021–0.030 ms after the
   * scored trigger in both channels; score-frame residual was -2.646 to
   * +0.030 ms. These are observations, not a device-independent latency bound.
   * spectrum remains the live, uncorrected analyser FFT. Its window ends roughly
   * baseLatency + outputLatency + lagSeconds ahead of the PCM; it is not a Fourier
   * transform of this PCM span. Scope therefore draws a corrected waveform
   * beside live spectrum bands; views combining them must account for the offset.
   * This measures rendered output, not speaker arrival or sample-internal delay.
   */
  audio?: {
    wave: Float32Array;
    spectrum: Uint8Array;
    left?: Float32Array;
    right?: Float32Array;
    channels?: 0 | 1 | 2;
    complete?: boolean;
    sampleRate?: number;
    endTime?: number;
    lagSeconds?: number;
  };
  structure?: ViewStructureLookup; // only for structure: true; no queries until asked
  samples?: SampleLookup; // only for samples: true; shared source PCM, never loads
}
export interface ViewHandle {
  frame(frame: ViewFrame): void;
  dispose(): void;
}
export interface ViewDefinition {
  id: string;
  group: 'rhythm' | 'pitch' | 'settings' | 'song' | 'show' | 'arcade';
  name: string;
  tag: string; // one or two words for the shelf, e.g. "whole song"
  needs?: 'score' | 'audio'; // default 'score'
  samples?: true; // independent of needs: can accompany score or audio
  structure?: true; // independent of needs and samples; lazy program snapshots
  span?: 'window' | 'song'; // 'song' asks the host for the whole song
  mount(el: HTMLElement): ViewHandle | Promise<ViewHandle>;
}
