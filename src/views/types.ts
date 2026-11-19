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
  span?: 'window' | 'song'; // 'song' asks the host for the whole song
  mount(el: HTMLElement): ViewHandle | Promise<ViewHandle>;
}
