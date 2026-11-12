import { instruments, sections, shared, walk, type Pattern, type Doc } from '../index';
import { findWithPath, freshIds, replaceAtPath, type Refusal } from './shared';
/** Mute references nearest the definition, keeping the shared definition intact. */
export function setUseMuted(
  doc: Doc,
  id: string,
  sectionId: string,
  muted: boolean,
): Doc | Refusal {
  const row = instruments(doc).find((r) => r.id === id);
  if (!row) return { ok: false, reason: 'This instrument no longer exists' };
  if (!sections(doc).some((s) => s.id === sectionId))
    return { ok: false, reason: 'This section no longer exists' };
  const uses = row.uses.filter((u) => u.path.some((n) => n.id === sectionId));
  if (!uses.length) return { ok: false, reason: 'This instrument is not used in this section' };
  const targets = uses.map((u) => u.path.at(-2)!);
  if (targets.some((n) => !('core' in n) || n.core.kind !== 'ref'))
    return { ok: false, reason: 'This use has no separate reference to mute' };
  if (targets.every((n) => !!n.muted === muted)) return doc;
  if (targets.some((n) => row.uses.some((u) => u.path.includes(n) && !uses.includes(u)))) {
    // A reused section needs its own references. Inline only group ancestors;
    // instrument definitions stay shared, so row identities and other uses survive.
    const scope = findWithPath(doc, sectionId)!,
      fresh = freshIds(doc);
    const definitionId = row.pattern.id;
    const leaves = new Set(instruments(doc).map((r) => r.pattern.id));
    let inseparable = false;
    const ancestry = new Set(uses.flatMap((u) => u.path.map((n) => n.id)));
    const targetIds = new Set(targets.map((n) => n.id));
    function local(p: Pattern): Pattern {
      if (targetIds.has(p.id)) return { ...p, muted };
      if (!ancestry.has(p.id)) return p;
      if (p.core.kind === 'ref') {
        const definition = shared(doc, p.core.name);
        if (definition && definition.id !== definitionId) {
          walk(
            {
              version: 1,
              body: [{ id: 'scan', tier: 1, kind: 'shared', name: 'scan', pattern: definition }],
            },
            (n) => {
              if (leaves.has(n.id)) inseparable = true;
            },
          );
          if (inseparable) return p;
          const copy = structuredClone(local(definition));
          walk(
            {
              version: 1,
              body: [{ id: 'copy', tier: 1, kind: 'shared', name: 'copy', pattern: copy }],
            },
            (n) => {
              n.id = fresh('use');
            },
          );
          return { ...p, core: { kind: 'group', how: 'stack', parts: [{ pattern: copy }] } };
        }
      }
      if (p.core.kind === 'group')
        return {
          ...p,
          core: {
            ...p.core,
            parts: p.core.parts.map((part) => ({ ...part, pattern: local(part.pattern) })),
          },
        };
      return p;
    }
    const replacement = local(scope.node as Pattern);
    return inseparable
      ? {
          ok: false,
          reason:
            'This section contains instruments that cannot yet be separated. Mute everywhere instead',
        }
      : replaceAtPath(doc, scope.path, replacement);
  }
  let next = doc;
  for (const node of targets) {
    if (!!node.muted === muted) continue;
    next = replaceAtPath(next, findWithPath(next, node.id)!.path, { ...node, muted });
  }
  return next;
}
