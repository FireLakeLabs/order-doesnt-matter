import type { Doc } from '../types';
import { sectionOwner, replaceParts, refuse } from './section-shared';
export function moveSection(doc: Doc, id: string, direction: -1 | 1) {
  const owner = sectionOwner(doc, id);
  if (!owner) return refuse();
  const to = owner.index + direction;
  if (to < 0 || to >= owner.parts.length)
    return refuse('This section is already at that end of the song');
  const parts = [...owner.parts];
  [parts[owner.index], parts[to]] = [parts[to], parts[owner.index]];
  return replaceParts(doc, owner.root, parts);
}
