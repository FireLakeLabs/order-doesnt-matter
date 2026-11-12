import type { Doc } from '../types';
import { editStep, refuse } from './step-shared';
export function splitRhythm(doc: Doc, id: string, path: number[], count: number) {
  if (!Number.isInteger(count) || count < 2 || count > 8) return refuse('Split into 2 to 8 parts');
  return editStep(doc, id, path, (s) => {
    if (!['value', 'rest', 'sub', 'alternate', 'together'].includes(s.kind))
      return refuse('Edit this chunk as source');
    const weight = 'weight' in s ? s.weight : undefined;
    const span = weight ?? (s.kind === 'value' ? s.repeat : undefined);
    return {
      kind: 'sub',
      steps: Array.from({ length: count }, () => s),
      ...(span === undefined ? {} : { weight: span }),
    };
  });
}
