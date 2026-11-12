import type { Doc } from '../types';
import { sectionOwner, replaceParts, refuse } from './section-shared';
export function setSectionLength(doc: Doc, id: string, cycles: number) {
  const owner = sectionOwner(doc, id);
  if (!owner) return refuse();
  if (
    !Number.isFinite(cycles) ||
    cycles <= 0 ||
    (owner.parts.every((p) => Number.isInteger(p.cycles ?? 1)) &&
      (!Number.isInteger(cycles) || cycles < 1))
  )
    return refuse(
      'Use a whole number of cycles, at least 1; existing fractional lengths can stay fractional',
    );
  if ((owner.part.cycles ?? 1) === cycles) return doc;
  return replaceParts(
    doc,
    owner.root,
    owner.parts.map((p, i) => (i === owner.index ? { ...p, cycles } : p)),
  );
}
