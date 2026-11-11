import type { Piece, Setting, Step, Voice } from './document';
const json = JSON.stringify;
function stepSource(step: Step, voice: Voice, path: number[]): string {
  if (step.kind === 'group') return `sequence(${step.steps.map((s, i) => stepSource(s, voice, [...path, i])).join(', ')})`;
  if (step.rest) return 'silence';
  return `pure(${json({ note: step.pitch, s: voice.sound, voice: voice.id, step: path.join('.'), ghost: false })})`;
}
function settingSource(s: Setting): string {
  if (s.kind === 'constant') return String(s.value);
  if (s.kind === 'steps') return `sequence(${s.values.join(', ')})`;
  return `signal(t => { const a = ${json(s.points)}, x = ((Number(t)%1+1)%1)*a.length, i = Math.floor(x); return a[i]+(a[(i+1)%a.length]-a[i])*(x-i); })`;
}
export function generate(piece: Piece): string {
  return `// mini-off\nstack(\n${piece.voices.map(v => {
    let code = `  sequence(${v.steps.map((s, i) => stepSource(s, v, [i])).join(', ')})`;
    for (const r of v.rewrites) {
      switch (r.kind) {
        case 'shift': code += `\n    .late(${r.cycles})`; break;
        case 'speed': code += `\n    .fast(${r.factor})`; break;
        case 'reverse': code += '\n    .rev()'; break;
        case 'echo': code += `\n    .off(${r.delay}, p => p.fmap(v => ({...v, note: v.note + ${r.semitones}, ghost: true})))`; break;
      }
    }
    for (const [name, s] of Object.entries(v.settings)) if (s) code += `\n    .${name}(${settingSource(s)})`;
    // Envelopes distinguish the synth drum without relying on external sample fetching.
    code += v.id === 'drum' ? '\n    .attack(0.001).decay(0.08).sustain(0).release(0.03)' : '\n    .attack(0.005).decay(0.12).sustain(0.15).release(0.08)';
    return code;
  }).join(',\n')}\n)`;
}
