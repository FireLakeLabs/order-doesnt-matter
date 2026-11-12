import { sections, type Doc } from '../index';
import { freshIds } from './shared';
import {
  sectionOwner,
  replaceParts,
  newSection,
  insertDefinition,
  refuse,
  shareInlineLeaves,
} from './section-shared';
export function duplicateSection(doc: Doc, id: string) {
  const initial = sectionOwner(doc, id);
  if (!initial) return refuse();
  doc = shareInlineLeaves(doc, id);
  const owner = sectionOwner(doc, id);
  if (!owner) return refuse();
  let pattern = owner.part.pattern,
    next = doc,
    part = owner.part;
  if (pattern.core.kind !== 'ref') {
    const content = pattern;
    const { definition, reference } = newSection(doc, undefined, content);
    const section = sections(doc).find((s) => s.id === id)!;
    definition.pattern.label = section.name;
    part = { ...part, label: section.name, labelSource: section.nameSource };
    pattern = reference;
    next = insertDefinition(next, definition);
  }
  const fresh = freshIds(next),
    parts = [...owner.parts];
  parts[owner.index] = { ...part, pattern };
  parts.splice(owner.index + 1, 0, {
    ...part,
    id: fresh('part'),
    pattern: { ...pattern, id: fresh('section') },
  });
  return replaceParts(next, owner.root, parts);
}
