import type { Doc } from '../types';
import { sectionOwner, replaceParts, refuse, shareInlineLeaves } from './section-shared';
export function removeSection(doc: Doc, id: string) {
  if (!sectionOwner(doc, id)) return refuse();
  doc = shareInlineLeaves(doc, id);
  const owner = sectionOwner(doc, id);
  if (!owner) return refuse();
  if (owner.parts.length === 1) return refuse('Keep at least one section in the song');
  return replaceParts(
    doc,
    owner.root,
    owner.parts.filter((_, i) => i !== owner.index),
  );
}
