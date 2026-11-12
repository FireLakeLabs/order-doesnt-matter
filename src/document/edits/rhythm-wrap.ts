import type { Doc } from '../types';
import { editStep, isGroup, refuse } from './step-shared';
import { rhythmValue } from './rhythm-set';
/** Wrap without changing the duration of the original slot. */
export function wrapRhythm(
  doc: Doc,
  id: string,
  path: number[],
  kind: 'alternate' | 'together',
  value: string,
) {
  const parsed = rhythmValue(doc, id, value);
  if ('ok' in parsed) return parsed;
  return editStep(doc, id, path, (s) => {
    if (!['value', 'rest', 'sub', 'alternate', 'together'].includes(s.kind))
      return refuse('Edit this chunk as source');
    if (isGroup(s) && s.kind === kind) return { ...s, steps: [...s.steps, parsed] };
    const weight =
      ('weight' in s ? s.weight : undefined) ?? (s.kind === 'value' ? s.repeat : undefined);
    const group = { kind, steps: [s, parsed] };
    return weight === undefined || weight === 1 ? group : { kind: 'sub', weight, steps: [group] };
  });
}
