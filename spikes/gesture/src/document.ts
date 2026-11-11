export type Step = { kind: 'note'; pitch: number; rest: boolean } | { kind: 'group'; steps: Step[] };
export type Setting = { kind: 'constant'; value: number } | { kind: 'steps'; values: number[] } | { kind: 'curve'; points: number[] };
export type Rewrite = { kind: 'shift'; cycles: number } | { kind: 'speed'; factor: number } | { kind: 'reverse' } | { kind: 'echo'; delay: number; semitones: number };
export type Voice = { id: string; name: string; sound: string; steps: Step[]; settings: Partial<Record<'lpf' | 'gain', Setting>>; rewrites: Rewrite[] };
export type Piece = { voices: Voice[] };
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const unit = (x: number) => ((x % 1) + 1) % 1;
const note = (pitch: number, rest = false): Step => ({ kind: 'note', pitch, rest });
export const initial = (): Piece => ({ voices: [
  { id: 'melody', name: 'GLASS / melody', sound: 'triangle', steps: [note(60), note(64), { kind: 'group', steps: [note(67), note(72)] }, note(69), note(67), note(64), note(62), note(67, true)], settings: { lpf: { kind: 'constant', value: 2200 }, gain: { kind: 'constant', value: 0.22 } }, rewrites: [] },
  { id: 'drum', name: 'PULSE / drum', sound: 'sine', steps: [note(36), note(36, true), note(43), note(36, true), note(36), note(43, true), note(43), note(36, true)], settings: { lpf: { kind: 'constant', value: 900 }, gain: { kind: 'constant', value: 0.45 } }, rewrites: [] },
] });
export type Leaf = { step: Extract<Step, { kind: 'note' }>; path: number[]; begin: number; end: number };
export function leaves(steps: Step[], prefix: number[] = [], begin = 0, width = 1): Leaf[] {
  return steps.flatMap((step, i) => {
    const start = begin + width * i / steps.length;
    const span = width / steps.length;
    return step.kind === 'group' ? leaves(step.steps, [...prefix, i], start, span) : [{ step, path: [...prefix, i], begin: start, end: start + span }];
  });
}
export function at(voice: Voice, path: number[]): Step | undefined {
  let steps = voice.steps;
  for (const [i, index] of path.entries()) {
    const step = steps[index];
    if (i === path.length - 1) return step;
    if (step?.kind !== 'group') return;
    steps = step.steps;
  }
}
function replace(voice: Voice, path: number[], replacement: Step): void {
  let steps = voice.steps;
  for (const index of path.slice(0, -1)) { const s = steps[index]; if (s?.kind !== 'group') return; steps = s.steps; }
  const index = path.at(-1); if (index !== undefined) steps[index] = replacement;
}
export type Edit =
  | { kind: 'shift'; cycles: number }
  | { kind: 'pitch'; path: number[]; semitones: number }
  | { kind: 'toggle'; path: number[] }
  | { kind: 'split'; path: number[] }
  | { kind: 'merge'; path: number[] }
  | { kind: 'paint'; setting: 'lpf' | 'gain'; mode: 'steps' | 'curve'; samples: { phase: number; value: number }[] }
  | { kind: 'speed'; factor: number }
  | { kind: 'echo'; delay: number; semitones: number }
  | { kind: 'reverse' };
export function edit(piece: Piece, id: string, action: Edit): Piece {
  const result = structuredClone(piece); const v = result.voices.find(v => v.id === id); if (!v) return result;
  switch (action.kind) {
    case 'shift': v.rewrites.push({ kind: 'shift', cycles: Math.round(action.cycles * 1e6) / 1e6 }); break;
    case 'speed': { const current = speed(v); v.rewrites.push({ kind: 'speed', factor: clamp(current * clamp(action.factor, .5, 2), .25, 4) / current }); } break;
    case 'reverse': v.rewrites.push({ kind: 'reverse' }); break;
    case 'echo': v.rewrites.push({ kind: 'echo', delay: Math.round(unit(action.delay) * 1e6) / 1e6, semitones: clamp(Math.round(action.semitones), -24, 24) }); break;
    case 'toggle': { const s = at(v, action.path); if (s?.kind === 'note') s.rest = !s.rest; break; }
    case 'pitch': { const s = at(v, action.path); if (s?.kind === 'note') s.pitch = clamp(s.pitch + Math.round(action.semitones), 24, 96); break; }
    case 'split': { const s = at(v, action.path); if (s?.kind === 'note') replace(v, action.path, { kind: 'group', steps: [structuredClone(s), structuredClone(s)] }); break; }
    case 'merge': { const parent = action.path.slice(0, -1); const s = at(v, parent); if (s?.kind === 'group') { const first = leaves(s.steps)[0]; if (first) replace(v, parent, structuredClone(first.step)); } break; }
    case 'paint': {
      const old = v.settings[action.setting];
      const values = Array.from({ length: 16 }, (_, i) => settingAt(old, i / 16));
      for (const s of action.samples) values[Math.floor(unit(s.phase) * 16)] = clamp(s.value, action.setting === 'lpf' ? 100 : 0, action.setting === 'lpf' ? 6000 : 1);
      v.settings[action.setting] = action.mode === 'steps' ? { kind: 'steps', values } : { kind: 'curve', points: values }; break;
    }
  }
  return result;
}
export function settingAt(s: Setting | undefined, phase: number): number {
  if (!s) return 0; if (s.kind === 'constant') return s.value;
  const values = s.kind === 'steps' ? s.values : s.points;
  const pos = unit(phase) * values.length, index = Math.floor(pos), a = values[index] ?? 0;
  return s.kind === 'steps' ? a : a + ((values[(index + 1) % values.length] ?? a) - a) * (pos - index);
}
export function speed(v: Voice): number { return v.rewrites.reduce((n, r) => r.kind === 'speed' ? n * r.factor : n, 1); }
