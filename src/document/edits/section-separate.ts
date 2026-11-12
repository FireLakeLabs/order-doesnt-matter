import { sections, type Doc, type Pattern } from '../index';
import { freshIds } from './shared';
import {
  sectionOwner,
  shareInlineLeaves,
  sectionUses,
  copyPattern,
  newSection,
  insertDefinition,
  replaceParts,
  refuse,
} from './section-shared';
export function separateSection(doc: Doc, id: string) {
  const initial = sectionOwner(doc, id);
  if (!initial) return refuse();
  if (sectionUses(doc, id) < 2) return refuse('This section is already separate');
  doc = shareInlineLeaves(doc, id);
  const owner = sectionOwner(doc, id)!;
  const binding = doc.body.find((n) => n.kind === 'shared' && n.pattern.id === owner.content.id);
  const fresh = freshIds(doc);
  // A section that is one shared instrument gets a stack of references, so
  // separating the section never copies the instrument itself.
  const content: Pattern =
    owner.content.core.kind !== 'group' && binding?.kind === 'shared'
      ? {
          id: fresh('copy'),
          tier: 1,
          core: {
            kind: 'group',
            how: 'stack',
            parts: [
              {
                pattern: {
                  id: fresh('use'),
                  tier: 1,
                  core: { kind: 'ref', name: binding.name },
                  layers: [],
                },
              },
            ],
          },
          layers: [],
        }
      : copyPattern(doc, owner.content);
  const label = sections(doc).find((s) => s.id === id)!.name;
  const { definition, reference } = newSection(doc, label, content);
  const pattern = { ...owner.part.pattern, core: reference.core };
  return insertDefinition(
    replaceParts(
      doc,
      owner.root,
      owner.parts.map((p, i) => (i === owner.index ? { ...p, label: undefined, pattern } : p)),
    ),
    definition,
  );
}
