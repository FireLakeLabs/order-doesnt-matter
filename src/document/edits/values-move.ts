import type { Doc } from '../types';
import { editList, refuse } from './values-shared';
export function moveValue(doc: Doc, id: string, path: number[], to: number) {
  const i = path.at(-1);
  return editList(doc, id, path.slice(0, -1), (steps) => {
    if (
      i === undefined ||
      !Number.isInteger(i) ||
      i < 0 ||
      !steps[i] ||
      !Number.isInteger(to) ||
      to < 0 ||
      to >= steps.length
    )
      return refuse('Choose a position in this group');
    if (i === to) return steps;
    const next = [...steps];
    next.splice(to, 0, ...next.splice(i, 1));
    return next;
  });
}
