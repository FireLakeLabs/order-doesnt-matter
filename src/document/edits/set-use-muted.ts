import { instruments, sections, shared, type Pattern, type Doc } from '../index';
import { freshIds, type Refusal } from './shared';
import { sectionOwner, replaceParts, copyPattern, shareInlineLeaves } from './section-shared';
/** Copy section structure only; instruments remain shared reference uses. */
export function setUseMuted(
  doc: Doc,
  id: string,
  sectionId: string,
  muted: boolean,
): Doc | Refusal {
  let rows = instruments(doc);
  const row = rows.find((r) => r.id === id);
  if (!row) return { ok: false, reason: 'This instrument no longer exists' };
  let owner = sectionOwner(doc, sectionId);
  if (!owner) return { ok: false, reason: 'This section no longer exists' };
  const uses = row.uses.filter((u) => u.path.some((n) => n.id === sectionId));
  if (!uses.length) return { ok: false, reason: 'This instrument is not used in this section' };
  if (uses.every((u) => u.muted === muted)) return doc;
  doc = shareInlineLeaves(doc, sectionId);
  rows = instruments(doc);
  owner = sectionOwner(doc, sectionId)!;
  const leaves = new Map(rows.map((r) => [r.pattern.id, r.pattern]));
  const fresh = freshIds(doc);
  let cyclic = false;
  function local(p: Pattern, seen = new Set<string>()): Pattern {
    if (seen.has(p.id)) {
      cyclic = true;
      return p;
    }
    seen = new Set(seen).add(p.id);
    if (p.origin) return p.origin === row!.pattern.id ? { ...p, muted } : p;
    if (p.core.kind === 'ref') {
      const target = shared(doc, p.core.name);
      if (target) {
        if (seen.has(target.id)) {
          cyclic = true;
          return p;
        }
        if (leaves.has(target.id)) return target.id === row!.pattern.id ? { ...p, muted } : p;
        const copy = local(copyPattern(doc, target, fresh), new Set(seen).add(target.id));
        return {
          ...copy,
          id: p.id,
          layers: [...copy.layers, ...p.layers],
          muted: !!p.muted || !!copy.muted,
        };
      }
    }
    if (p.core.kind === 'group')
      return {
        ...p,
        core: {
          ...p.core,
          parts: p.core.parts.map((part) => ({ ...part, pattern: local(part.pattern, seen) })),
        },
      };
    return p;
  }
  const pattern = local(owner.part.pattern);
  if (cyclic) return { ok: false, reason: 'A cyclic shared reference cannot be localized safely' };
  const section = sections(doc).find((s) => s.id === sectionId)!;
  return replaceParts(
    doc,
    owner.root,
    owner.parts.map((part) =>
      part.id === sectionId
        ? { ...part, label: section.name, labelSource: section.nameSource, pattern }
        : part,
    ),
  );
}
