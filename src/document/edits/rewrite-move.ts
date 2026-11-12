import type { Doc } from '../types';
import { replaceAtPath, type Refusal } from './shared';
import { rewriteOwner } from './rewrite-shared';
/** Adjacent rewrite slots only: settings and opaque source remain barriers. */
export function moveRewrite(doc: Doc, id: string, direction: -1 | 1): Doc | Refusal {
  const owner = rewriteOwner(doc, id);
  if (!owner) return { ok: false, reason: 'This rewrite no longer exists' };
  const layers = owner.pattern.layers,
    other = owner.index + direction;
  if (![-1, 1].includes(direction) || layers[other]?.kind !== 'rewrite')
    return {
      ok: false,
      reason: 'No rewrite in that direction before a setting, source text or the edge',
    };
  const next = [...layers];
  [next[owner.index], next[other]] = [next[other], next[owner.index]];
  return replaceAtPath(doc, [...owner.path, 'layers'], next);
}
