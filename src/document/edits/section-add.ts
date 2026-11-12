import type { Doc } from '../types';
import { song, replaceParts, newSection, insertDefinition, refuse } from './section-shared';
export function addSection(doc: Doc) {
  const root = song(doc);
  if (!root || root.core.kind !== 'group') return refuse('Make sections first');
  const { definition, reference } = newSection(doc);
  return insertDefinition(
    replaceParts(doc, root, [...root.core.parts, { cycles: 4, pattern: reference }]),
    definition,
  );
}
