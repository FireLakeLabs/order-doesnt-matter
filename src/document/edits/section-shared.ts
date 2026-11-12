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
  const index = root.core.parts.findIndex((p) => p.pattern.id === id);
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
/** Reserved binding names carry generated-name provenance through existing serialization. */
export function newSection(doc: Doc, label?: string, content?: Pattern) {
  const fresh = freshIds(doc),
    names = new Set(sections(doc).map((s) => s.name));
  let n = label ? 2 : 1;
  while (
    names.has(label ? `${label} ${n}` : `Section ${n}`) ||
    doc.body.some((b) => b.kind === 'shared' && b.name === `__odm_section_${n}`)
  )
    n++;
  const name = `__odm_section_${n}`;
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
  walk(
    { version: 1, body: [{ id: 'scan', tier: 1, kind: 'shared', name: 'scan', pattern: copy }] },
    (n) => {
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
  const fresh = freshIds(doc);
  for (const row of instruments(doc).filter((r) =>
    r.uses.some((u) => u.path.some((p) => p.id === scope)),
  )) {
    if (doc.body.some((n) => n.kind === 'shared' && n.pattern.id === row.pattern.id)) continue;
    if (sections(doc).some((s) => s.id === row.pattern.id)) continue;
    const name = `__odm_instrument_${fresh('leaf')}`;
    const definition = {
      id: fresh('definition'),
      tier: 1 as const,
      kind: 'shared' as const,
      name,
      pattern: row.pattern,
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
  }
  return next;
}
