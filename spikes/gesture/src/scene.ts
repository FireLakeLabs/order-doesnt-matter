import { leaves, settingAt, speed, unit, type Piece, type Voice } from './document';
export type Event = { begin: number; end: number; note: number; voice: string; step: string; ghost: boolean; lpf: number; gain: number };
export type Shape = { kind: 'arc'; role: 'note' | 'rest' | 'ghost' | 'setting' | 'track'; voice: string; path: number[]; begin: number; end: number; radius: number; width: number; value: number; setting?: 'lpf' | 'gain' };
export const centers = [{ x: 270, y: 290 }, { x: 770, y: 290 }];
export const noteRadius = (note: number, v: Voice) => 105 + (note - (v.id === 'drum' ? 36 : 60)) * 1.25;
// Rest guides are editable score locations even though Strudel correctly emits no event.
function restPositions(v: Voice): Shape[] {
  return leaves(v.steps).filter(l => l.step.rest).flatMap(l => {
    let spans = [{ begin: l.begin, end: l.end }];
    for (const r of v.rewrites) {
      if (r.kind === 'shift') spans = spans.map(s => ({ begin: s.begin + r.cycles, end: s.end + r.cycles }));
      if (r.kind === 'reverse') spans = spans.map(s => ({ begin: 1 - s.end, end: 1 - s.begin }));
      if (r.kind === 'speed') spans = spans.flatMap(s => Array.from({ length: Math.ceil(r.factor) + 1 }, (_, i) => ({ begin: (s.begin + i) / r.factor, end: (s.end + i) / r.factor }))).filter(s => s.begin < 1);
    }
    return spans.map(s => ({ kind: 'arc', role: 'rest', voice: v.id, path: l.path, begin: unit(s.begin), end: unit(s.begin) + s.end - s.begin, radius: noteRadius(l.step.pitch, v), width: 15, value: l.step.pitch } satisfies Shape));
  });
}
export function scene(piece: Piece, events: Event[]): Shape[] {
  return piece.voices.flatMap(v => {
    const shapes: Shape[] = [{ kind: 'arc', role: 'track', voice: v.id, path: [], begin: 0, end: 1, radius: 67, width: 20, value: speed(v) }];
    for (const [index, [setting, s]] of Object.entries(v.settings).entries()) {
      if (!s || (setting !== 'lpf' && setting !== 'gain')) continue;
      for (let i = 0; i < 64; i++) shapes.push({ kind: 'arc', role: 'setting', voice: v.id, path: [], begin: i / 64, end: (i + 1) / 64, radius: 160 + index * 28, width: 21, value: settingAt(s, i / 64), setting });
    }
    shapes.push(...restPositions(v));
    for (const e of events.filter(e => e.voice === v.id)) {
      const wrap = Math.floor(Math.max(0, e.begin) * Math.max(1, speed(v)));
      shapes.push({ kind: 'arc', role: e.ghost ? 'ghost' : 'note', voice: v.id, path: e.step.split('.').map(Number), begin: e.begin, end: e.end, radius: e.ghost ? 222 : noteRadius(e.note, v) + Math.min(3, wrap) * 10, width: e.ghost ? 9 : 15, value: e.note });
    }
    return shapes;
  });
}
