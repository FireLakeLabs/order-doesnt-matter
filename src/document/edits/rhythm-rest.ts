import type { Doc } from '../types';
import { toggleRest } from './values-rest';
export function restRhythm(doc: Doc, id: string, path: number[]) {
  return toggleRest(doc, id, path);
}
