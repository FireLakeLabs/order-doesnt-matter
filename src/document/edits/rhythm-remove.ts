import type { Doc } from '../types';
import { editList, editStep, isGroup, refuse } from './step-shared';
import { keepRhythmSpan, rhythmWeight } from './rhythm-join';
/** Remove a slot when siblings remain. The only slot becomes a rest, so the
 * containing sequence stays valid. Split/turn groups collapse at one child. */
export function removeRhythm(doc: Doc, id: string, path: number[]) {
  const i = path.at(-1),
    parent = path.slice(0, -1);
  const next = editList(doc, id, parent, (steps) => {
    if (i === undefined || !Number.isInteger(i) || i < 0 || !steps[i])
      return refuse('Choose an existing value');
    return steps.length === 1
      ? [{ kind: 'rest', weight: rhythmWeight(steps[i]) }]
      : steps.filter((_, j) => i !== j);
  });
  if ('ok' in next || !parent.length) return next;
  return editStep(next, id, parent, (s) =>
    isGroup(s) && s.steps.length === 1 ? keepRhythmSpan(s.steps[0], rhythmWeight(s)) : s,
  );
}
