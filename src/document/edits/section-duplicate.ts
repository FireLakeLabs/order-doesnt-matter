import type { Doc } from '../types';
import { freshIds } from './shared';
import { sectionOwner, replaceParts, newSection, insertDefinition, refuse } from './section-shared';
export function duplicateSection(doc: Doc, id: string) {
  const owner = sectionOwner(doc, id);
  if (!owner) return refuse();
  let pattern = owner.part.pattern,
    next = doc;
  if (pattern.core.kind !== 'ref') {
    const fresh = freshIds(doc),
      content = { ...pattern, id: fresh('definition') };
    const { definition, reference } = newSection(doc, undefined, content);
    pattern = { ...reference, id: pattern.id };
    next = insertDefinition(next, definition);
  }
  const fresh = freshIds(next),
    parts = [...owner.parts];
  parts[owner.index] = { ...owner.part, pattern };
  parts.splice(owner.index + 1, 0, {
    ...owner.part,
    pattern: { ...pattern, id: fresh('section') },
  });
  return replaceParts(next, owner.root, parts);
}
