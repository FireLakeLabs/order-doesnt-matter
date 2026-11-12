import type { Doc } from '../types';
import { editStep, refuse } from './values-shared';
export function setModifier(
  doc: Doc,
  id: string,
  path: number[],
  name: 'weight' | 'repeat' | 'chance',
  value: number,
) {
  if (
    !Number.isFinite(value) ||
    (name === 'chance' ? value < 0 || value > 1 : value <= 0) ||
    (name === 'repeat' && !Number.isInteger(value))
  )
    return refuse('Use a positive length or whole repeat count, or a chance from 0 to 1');
  return editStep(doc, id, path, (s) => {
    if (s.kind !== 'value' && !(name === 'weight' && (s.kind === 'sub' || s.kind === 'rest')))
      return refuse('This value does not support that modifier');
    return { ...s, [name]: value };
  });
}
