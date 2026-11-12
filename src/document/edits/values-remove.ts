import type { Doc } from '../types';
import { editList, refuse } from './values-shared';
export function removeValue(doc: Doc, id: string, path: number[]) {
  const i = path.at(-1);
  return editList(doc, id, path.slice(0, -1), (steps) =>
    i === undefined || !Number.isInteger(i) || i < 0 || !steps[i]
      ? refuse('Choose an existing value')
      : steps.length === 1
        ? refuse('Keep one value; switch it off to leave a rest')
        : steps.filter((_, j) => i !== j),
  );
}
