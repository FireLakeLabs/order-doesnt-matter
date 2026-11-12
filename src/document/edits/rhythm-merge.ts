import type { Doc, Step } from '../types';
import { editStep, isGroup, refuse } from './step-shared';
export function mergeRhythm(doc: Doc, id: string, path: number[], confirmed = false) {
  return editStep(doc, id, path, (s) => {
    if (!isGroup(s) || !s.steps.length) return refuse('Choose a group to merge');
    if (!confirmed && s.steps.some((c) => !['value', 'rest'].includes(c.kind)))
      return refuse('Merging discards nested parts; confirm first');
    let first: Step = s.steps[0];
    while (isGroup(first) && first.steps.length) first = first.steps[0];
    if (first.kind !== 'value' && first.kind !== 'rest')
      return refuse('The first part is a source chunk');
    const weight = s.kind === 'sub' ? s.weight : undefined;
    // The merged value occupies the group's slot, not its former child's weight.
    if (first.kind === 'rest') return { ...first, weight: weight ?? 1 };
    return { ...first, repeat: undefined, weight: weight ?? 1 };
  });
}
