import {
  instruments,
  sections,
  shared,
  voices,
  walk,
  type Doc,
  type Pattern,
  type GroupPart,
} from '../index';
import { findWithPath, freshIds, replaceAtPath, type Refusal } from './shared';
export const refuse = (reason = 'This section no longer exists'): Refusal => ({
  ok: false,
  reason,
});
export function resolveSection(doc: Doc, pattern: Pattern): Pattern {
  const seen = new Set<string>();
  while (pattern.core.kind === 'ref' && !seen.has(pattern.id)) {
    seen.add(pattern.id);
    const next = shared(doc, pattern.core.name);
    if (!next) break;
    pattern = next;
  }
  return pattern;
}
export function song(doc: Doc) {
  const roots = voices(doc);
  const root = roots.length === 1 ? resolveSection(doc, roots[0].pattern) : undefined;
  return root?.core.kind === 'group' && root.core.how === 'arrange' ? root : undefined;
}
export function sectionOwner(doc: Doc, id: string) {
  const root = song(doc);
  if (!root || root.core.kind !== 'group') return;
  const index = root.core.parts.findIndex((p) => p.id === id);
  if (index < 0) return;
  const part = root.core.parts[index],
    content = resolveSection(doc, part.pattern);
  return { root, parts: root.core.parts, part, index, content };
}
export function replaceParts(doc: Doc, root: Pattern, parts: GroupPart[]): Doc {
  return replaceAtPath(doc, findWithPath(doc, root.id)!.path, {
    ...root,
    core: { ...root.core, parts },
  });
}
export function sectionUses(doc: Doc, id: string) {
  const owner = sectionOwner(doc, id);
  return (
    owner?.parts.filter((p) => resolveSection(doc, p.pattern).id === owner.content.id).length ?? 0
  );
}
/** Ordinary bindings; display names and provenance are serialized independently. */
export function newSection(doc: Doc, label?: string, content?: Pattern) {
  const fresh = freshIds(doc),
    names = new Set(sections(doc).map((s) => s.name));
  let n = label ? 2 : 1;
  while (
    names.has(label ? `${label} ${n}` : `Section ${n}`) ||
    doc.body.some((b) => b.kind === 'shared' && b.name === `section${n}`)
  )
    n++;
  const name = `section${n}`;
  const pattern: Pattern = content
    ? { ...content, label: label ? `${label} ${n}` : `Section ${n}` }
    : {
        id: fresh('section'),
        tier: 1,
        label: `Section ${n}`,
        core: { kind: 'generator', name: 'silence', args: [] },
        layers: [],
      };
  const definition = {
    id: fresh('section'),
    tier: 1 as const,
    kind: 'shared' as const,
    name,
    nameSource: 'generated' as const,
    purpose: 'section' as const,
    pattern,
  };
  const reference: Pattern = {
    id: fresh('section'),
    tier: 1,
    core: { kind: 'ref', name },
    layers: [],
  };
  return { definition, reference };
}
export function copyPattern(doc: Doc, pattern: Pattern, fresh = freshIds(doc)) {
  const copy = structuredClone(pattern);
  const leaves = new Set(instruments(doc).map((r) => r.pattern.id));
  walk(
    {
      version: 2,
      body: [
        {
          id: 'scan',
          tier: 1,
          kind: 'shared',
          nameSource: 'generated',
          name: 'scan',
          pattern: copy,
        },
      ],
    },
    (n) => {
      if ('core' in n && leaves.has(n.id)) (n as Pattern).origin ??= n.id;
      n.id = fresh('copy');
    },
  );
  return copy;
}
/** Insert after its dependencies but before every voice that may use it. */
export function insertDefinition(doc: Doc, definition: Doc['body'][number]): Doc {
  const index = doc.body.findIndex((n) => n.kind === 'voice');
  return { ...doc, body: [...doc.body.slice(0, index), definition, ...doc.body.slice(index)] };
}

/** Hoist inline leaves before copying groups, retaining each canonical instrument id. */
export function shareInlineLeaves(doc: Doc, scope: string): Doc {
  let next = doc;
  const previousSections = sections(doc);
  const originalRoot = song(doc);
  const fresh = freshIds(doc);
  for (const row of instruments(doc).filter((r) =>
    r.uses.some((u) => u.path.some((p) => p.id === scope)),
  )) {
    if (doc.body.some((n) => n.kind === 'shared' && n.pattern.id === row.pattern.id)) continue;
    let name: string;
    do {
      name = `instrument${fresh('leaf')}`;
    } while (next.body.some((n) => n.kind === 'shared' && n.name === name));
    const definition = {
      id: fresh('definition'),
      tier: 1 as const,
      kind: 'shared' as const,
      name,
      nameSource: row.nameSource,
      purpose: 'instrument' as const,
      pattern: { ...row.pattern, label: row.name },
    };
    const found = findWithPath(next, row.pattern.id)!;
    next = replaceAtPath(next, found.path, {
      id: fresh('use'),
      tier: 1,
      core: { kind: 'ref', name },
      layers: [],
    });
    const index = found.path[1] as number;
    next = { ...next, body: [...next.body.slice(0, index), definition, ...next.body.slice(index)] };
    // Naming an instrument does not rename the section containing that bare leaf.
    const root = song(next);
    if (root?.core.kind === 'group' && originalRoot?.core.kind === 'group') {
      const affected = new Set(
        originalRoot.core.parts
          .filter((part) => part.pattern.id === row.pattern.id)
          .map((part) => part.id),
      );
      next = replaceParts(
        next,
        root,
        root.core.parts.map((part) => {
          const section = previousSections.find((s) => s.id === part.id);
          return affected.has(part.id) && part.label === undefined && section
            ? { ...part, label: section.name, labelSource: section.nameSource }
            : part;
        }),
      );
    }
  }
  return next;
}
