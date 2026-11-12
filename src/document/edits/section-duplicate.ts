import { sections, type Doc } from '../index';
import { freshIds } from './shared';
import { sectionOwner, replaceParts, newSection, insertDefinition, refuse } from './section-shared';
export function duplicateSection(doc: Doc, id: string) {
  const owner = sectionOwner(doc, id);
  if (!owner) return refuse();
  let pattern = owner.part.pattern,
    next = doc,
    part = owner.part;
  if (pattern.core.kind !== 'ref') {
    const fresh = freshIds(doc),
      content = { ...pattern, id: fresh('definition') };
    const { definition, reference } = newSection(doc, undefined, content);
    const section = sections(doc).find((s) => s.id === id)!;
    definition.pattern.label = section.name;
    if (section.nameSource === 'author') part = { ...part, label: section.name };
    pattern = { ...reference, id: pattern.id };
    next = insertDefinition(next, definition);
  }
  const fresh = freshIds(next),
    parts = [...owner.parts];
  parts[owner.index] = { ...part, pattern };
  parts.splice(owner.index + 1, 0, {
    ...part,
    pattern: { ...pattern, id: fresh('section') },
  });
  return replaceParts(next, owner.root, parts);
}
