import type { Doc } from '../types';
import { replaceAtPath, type Refusal } from './shared';
import { rewriteOwner } from './rewrite-shared';
export function removeRewrite(doc: Doc, id: string): Doc | Refusal {
  const owner = rewriteOwner(doc, id);
  return owner
    ? replaceAtPath(
        doc,
        [...owner.path, 'layers'],
        owner.pattern.layers.filter((l) => l.id !== id),
      )
    : { ok: false, reason: 'This rewrite no longer exists' };
}
