import { instruments, shared, sections, type Doc, type Pattern } from '../index';
import { definitionMuted } from './set-muted';
import { findWithPath, freshIds, replaceAtPath } from './shared';
import {
  sectionOwner,
  newSection,
  replaceParts,
  resolveSection,
  shareInlineLeaves,
  copyPattern,
  insertDefinition,
  refuse,
} from './section-shared';
export function setInstrumentInSection(doc: Doc, id: string, instrumentId: string, plays: boolean) {
  let owner = sectionOwner(doc, id);
  let row = instruments(doc).find((r) => r.id === instrumentId);
  if (!owner) return refuse();
  if (!row) return refuse('This instrument no longer exists');
  let uses = row.uses.filter((u) => u.path.some((n) => n.id === id));
  if (plays && definitionMuted(doc, instrumentId))
    return refuse('This instrument is muted everywhere. Open its instrument editor to unmute it');
  if (uses.length && uses.some((u) => !u.muted) === plays) return doc;
  if (!uses.length && !plays) return doc;
  doc = shareInlineLeaves(doc, id);
  owner = sectionOwner(doc, id)!;
  row = instruments(doc).find((r) => r.id === instrumentId)!;
  uses = row.uses.filter((u) => u.path.some((n) => n.id === id));
  if (uses.length) {
    // The section itself can be a single leaf; its occurrence is the mute boundary.
    if (owner.content.id === row.pattern.id) {
      return replaceParts(
        doc,
        owner.root,
        owner.parts.map((part) =>
          resolveSection(doc, part.pattern).id === owner!.content.id
            ? { ...part, pattern: { ...part.pattern, muted: !plays } }
            : part,
        ),
      );
    }
    const nestedGroups = uses
      .flatMap((u) => u.path.slice(u.path.findIndex((p) => p.id === owner!.content.id) + 1, -1))
      .filter(
        (p): p is Pattern =>
          'core' in p && p.core.kind === 'ref' && shared(doc, p.core.name)?.id !== row!.pattern.id,
      );
    for (const group of nestedGroups) doc = shareInlineLeaves(doc, group.id);
    owner = sectionOwner(doc, id)!;
    row = instruments(doc).find((r) => r.id === instrumentId)!;
    const ancestry = new Set(
      row.uses
        .filter((u) => u.path.some((n) => n.id === id))
        .flatMap((u) => u.path.map((n) => n.id)),
    );
    const copyIds = freshIds(doc);
    function local(p: Pattern): Pattern {
      if (!ancestry.has(p.id)) return p;
      if (p.core.kind === 'ref') {
        const target = shared(doc, p.core.name);
        if (target?.id === row!.pattern.id) return { ...p, muted: !plays };
        if (target && ancestry.has(target.id)) {
          const copy = copyPattern(doc, local(target), copyIds);
          copy.label ??= p.core.name;
          return {
            ...p,
            core: { kind: 'group', how: 'stack', parts: [{ id: copyIds('part'), pattern: copy }] },
          };
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
      return (p.origin ?? p.id) === row!.pattern.id ? { ...p, muted: !plays } : p;
    }
    return replaceAtPath(doc, findWithPath(doc, owner.content.id)!.path, local(owner.content));
  }
  if (!plays) return doc;
  let definition = doc.body.find((n) => n.kind === 'shared' && n.pattern.id === row!.pattern.id);
  if (definition?.kind !== 'shared') {
    doc = shareInlineLeaves(doc, row.pattern.id);
    definition = doc.body.find((n) => n.kind === 'shared' && n.pattern.id === row!.pattern.id);
    if (definition?.kind !== 'shared')
      return refuse('This instrument could not be promoted to a shared definition');
    owner = sectionOwner(doc, id)!;
  }
  const fresh = freshIds(doc),
    reference: Pattern = {
      id: fresh('use'),
      tier: 1,
      core: { kind: 'ref', name: definition.name },
      layers: [],
    };
  const content = owner.content;
  // A leaf definition remains an instrument. Give its section a shared stack of uses.
  if (content.core.kind !== 'group' || content.core.how !== 'stack') {
    const section = sections(doc).find((s) => s.id === id)!;
    const old = owner.part.pattern;
    const first: Pattern =
      old.core.kind === 'ref'
        ? { id: fresh('use'), tier: 1, core: old.core, layers: [] }
        : { ...content, id: fresh('leaf') };
    const stack: Pattern = {
      id: fresh('stack'),
      tier: 1,
      core: {
        kind: 'group',
        how: 'stack',
        parts: [
          { id: fresh('part'), pattern: first },
          { id: fresh('part'), pattern: reference },
        ],
      },
      layers: [],
    };
    const added = newSection(doc, undefined, stack);
    added.definition.pattern.label = section.name;
    const next = replaceParts(
      doc,
      owner.root,
      owner.parts.map((part) =>
        resolveSection(doc, part.pattern).id === content.id
          ? {
              ...part,
              label: section.name,
              labelSource: section.nameSource,
              pattern: {
                ...part.pattern,
                core: added.reference.core,
                ...(old.core.kind === 'ref' ? {} : { layers: [] }),
              },
            }
          : part,
      ),
    );
    return insertDefinition(next, added.definition);
  }
  return replaceAtPath(doc, findWithPath(doc, content.id)!.path, {
    ...content,
    core: {
      ...content.core,
      parts: [...content.core.parts, { id: fresh('part'), pattern: reference }],
    },
  });
}
