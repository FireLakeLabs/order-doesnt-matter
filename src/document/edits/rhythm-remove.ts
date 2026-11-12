import type { Doc } from '../types';
import { editStep, isGroup } from './step-shared';
import { removeValue } from './values-remove';
export function removeRhythm(doc: Doc, id: string, path: number[]) {
  const next = removeValue(doc, id, path);
  if ('ok' in next || path.length < 2) return next;
  return editStep(next, id, path.slice(0, -1), (s) =>
    isGroup(s) && s.kind !== 'sub' && s.steps.length === 1 ? s.steps[0] : s,
  );
}
