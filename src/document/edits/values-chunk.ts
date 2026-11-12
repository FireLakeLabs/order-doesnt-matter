import type { Doc } from '../types';
import { parseSteps } from '../../import/mini';
import { editList, refuse } from './values-shared';
export function replaceChunk(doc: Doc, id: string, path: number[], text: string) {
  let replacement;
  try {
    replacement = parseSteps(text);
  } catch {
    return refuse('This pattern does not parse; previous values kept');
  }
  if (!text.trim() || !replacement.length) return refuse('Enter a pattern for this chunk');
  const i = path.at(-1);
  return editList(doc, id, path.slice(0, -1), (steps) =>
    i === undefined ||
    !Number.isInteger(i) ||
    i < 0 ||
    !steps[i] ||
    !['euclid', 'polymeter', 'choose', 'other'].includes(steps[i].kind)
      ? refuse('Choose a text pattern chunk')
      : [...steps.slice(0, i), ...replacement, ...steps.slice(i + 1)],
  );
}
