import type { Doc } from '../types';
import { atom, editList, refuse } from './values-shared';
export function insertValue(doc: Doc, id: string, parent: number[], index: number, value = '1') {
  const step = atom(value);
  if ('ok' in step) return step;
  return editList(doc, id, parent, (steps) =>
    !Number.isInteger(index) || index < 0 || index > steps.length
      ? refuse('Choose a position in this group')
      : [...steps.slice(0, index), step, ...steps.slice(index)],
  );
}
