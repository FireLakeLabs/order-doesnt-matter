import type { Doc } from '../types';
import { atom, refuse, sequenceOwner } from './step-shared';
import { setValue } from './values-set';
export function rhythmValue(doc: Doc, id: string, value: string) {
  const control = sequenceOwner(doc, id)?.control;
  const parsed = atom(value);
  if ('ok' in parsed) return parsed;
  const numeric = value.trim() !== '' && Number.isFinite(Number(value));
  if (control === 'note' && !numeric && !/^[a-gA-G](?:#{1,2}|b{1,2})?-?\d+$/.test(value))
    return refuse('Enter a note with its octave, or a note number');
  if ((control === 'n' || control === 'freq') && !numeric) return refuse('Enter a finite number');
  if (!control) return refuse('Choose a note or sound sequence');
  return parsed;
}
export function setRhythmValue(doc: Doc, id: string, path: number[], value: string) {
  const parsed = rhythmValue(doc, id, value);
  return 'ok' in parsed ? parsed : setValue(doc, id, path, value);
}
