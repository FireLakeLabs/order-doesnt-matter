import type { Doc } from '../types';
import { editList, editStep, refuse } from './values-shared';
export function changeGroup(doc: Doc, id: string, path: number[], kind: 'sub' | 'alternate') {
  if (!path.length)
    return editList(doc, id, [], (steps) => (kind === 'sub' ? steps : [{ kind, steps }]));
  return editStep(doc, id, path, (s) => {
    if (s.kind !== 'sub' && s.kind !== 'alternate')
      return refuse('Choose a group that plays in sequence or takes turns');
    if (s.kind === kind) return s;
    // A wrapper keeps the duration of a weighted group while its children take turns.
    return s.kind === 'sub' && s.weight !== undefined
      ? { ...s, steps: [{ kind, steps: s.steps }] }
      : { kind, steps: s.steps };
  });
}
