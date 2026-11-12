import type { Doc, Step } from '../types';
import { editStep, isGroup, refuse } from './step-shared';
export const rhythmWeight = (s: Step) =>
  ('weight' in s ? s.weight : undefined) ?? (s.kind === 'value' ? s.repeat : undefined) ?? 1;
/** A collapsed child inherits its parent's slot, rather than its former share. */
export function keepRhythmSpan(s: Step, weight: number): Step {
  if (rhythmWeight(s) === weight) return s;
  return ['value', 'rest', 'sub'].includes(s.kind)
    ? ({ ...s, weight } as Step)
    : { kind: 'sub', weight, steps: [s] };
}
export function joinRhythm(doc: Doc, id: string, path: number[]) {
  return editStep(doc, id, path, (s) => {
    if (!isGroup(s)) return refuse('Choose a split or a group taking turns');
    return keepRhythmSpan(
      s.steps.find((c) => c.kind !== 'rest') ?? { kind: 'rest' },
      rhythmWeight(s),
    );
  });
}
