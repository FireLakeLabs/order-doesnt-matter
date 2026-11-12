import { instruments, type Doc } from '../index';
import { findWithPath, replaceAtPath, type Refusal } from './shared';
import { shareInlineLeaves } from './section-shared';
export function renameInstrument(doc: Doc, id: string, input: string): Doc | Refusal {
  const rows = instruments(doc),
    row = rows.find((r) => r.id === id);
  if (!row) return { ok: false, reason: 'This instrument no longer exists' };
  const name = input.trim();
  if (!name) return { ok: false, reason: 'Give this instrument a name' };
  if (name.includes('$')) return { ok: false, reason: 'Choose a name without a dollar sign' };
  if (rows.some((r) => r.id !== id && r.name === name))
    return { ok: false, reason: 'Another instrument already has that name' };
  if (row.name === name && row.nameSource === 'author') return doc;
  // Promotion transfers the leaf id to the definition and allocates its use id.
  doc = shareInlineLeaves(doc, row.pattern.id);
  // A label wins over a shared binding's name without changing any references.
  const found = findWithPath(doc, row.pattern.id)!;
  let next = replaceAtPath(doc, found.path, { ...row.pattern, label: name });
  next = {
    ...next,
    body: next.body.map((n) =>
      n.kind === 'shared' && n.pattern.id === row.pattern.id
        ? { ...n, nameSource: 'author', purpose: 'instrument' }
        : n,
    ),
  };
  return next;
}
