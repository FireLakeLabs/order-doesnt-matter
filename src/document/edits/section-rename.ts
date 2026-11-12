import { sections, type Doc } from '../index';
import { findWithPath, replaceAtPath } from './shared';
import { sectionOwner, resolveSection, replaceParts, refuse } from './section-shared';
export function renameSection(doc: Doc, id: string, input: string) {
  const owner = sectionOwner(doc, id),
    name = input.trim();
  if (!owner) return refuse();
  if (!name) return refuse('Give this section a name');
  if (name.includes('$')) return refuse('Choose a name without a dollar sign');
  if (
    sections(doc).some(
      (s) =>
        s.name === name &&
        resolveSection(doc, sectionOwner(doc, s.id)!.part.pattern).id !== owner.content.id,
    )
  )
    return refuse('Another section already has that name');
  if (owner.part.pattern.core.kind === 'ref') {
    // Human names are labels; JavaScript bindings and opaque source stay intact.
    let next = replaceAtPath(doc, findWithPath(doc, owner.content.id)!.path, {
      ...owner.content,
      label: name,
    });
    const current = sectionOwner(next, id)!;
    next = replaceParts(
      next,
      current.root,
      current.parts.map((p) =>
        resolveSection(next, p.pattern).id === owner.content.id
          ? { ...p, label: name, labelSource: 'author' }
          : p,
      ),
    );
    return next;
  }
  return replaceParts(
    doc,
    owner.root,
    owner.parts.map((p, i) =>
      i === owner.index ? { ...p, label: name, labelSource: 'author' } : p,
    ),
  );
}
