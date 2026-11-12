import type { Doc } from '../types';
import { insertValue } from './values-insert';
import { rhythmValue } from './rhythm-set';
export function insertRhythm(doc: Doc, id: string, parent: number[], index: number, value: string) {
  const parsed = rhythmValue(doc, id, value);
  return 'ok' in parsed ? parsed : insertValue(doc, id, parent, index, value);
}
