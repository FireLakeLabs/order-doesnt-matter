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
  audio?: { wave: Float32Array; spectrum: Uint8Array }; // only for needs: 'audio'
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
  span?: 'window' | 'song'; // 'song' asks the host for the whole song
  mount(el: HTMLElement): ViewHandle | Promise<ViewHandle>;
}
