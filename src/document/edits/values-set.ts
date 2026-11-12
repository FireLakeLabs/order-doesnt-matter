import type { Doc } from '../types';
import { atom, editStep, refuse } from './values-shared';
export function setValue(doc: Doc, id: string, path: number[], value: string) {
  const parsed = atom(value);
  if ('ok' in parsed) return parsed;
  return editStep(doc, id, path, (s) =>
    s.kind !== 'value'
      ? refuse('Choose an enabled value')
      : s.value === value
        ? s
        : { ...s, value },
  );
}
