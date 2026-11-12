import type { Doc } from '../types';
import { refuse } from './step-shared';
import { setModifier } from './values-modifier';
export function rhythmModifier(
  doc: Doc,
  id: string,
  path: number[],
  name: 'weight' | 'repeat',
  value: number,
) {
  if (!Number.isSafeInteger(value) || value < 1) return refuse('Use a whole number of at least 1');
  return setModifier(doc, id, path, name, value);
}
