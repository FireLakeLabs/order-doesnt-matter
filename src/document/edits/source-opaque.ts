import type { Doc } from '../types';
import { installSource } from './source-shared';
/** Retains exactly the entered source, after parsing the generated piece in place. */
export const replaceOpaque = (doc: Doc, id: string, code: string) =>
  installSource(doc, id, code, false);
