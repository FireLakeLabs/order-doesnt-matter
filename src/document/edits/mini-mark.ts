import type { Doc, MiniMark } from '../types';
import { parseSteps } from '../../import/mini';
import { editMiniStep, refuse, type MiniPath } from './step-shared';
import { safeMini } from './mini-shared';
/** Replace/remove exactly one written occurrence, or append at marks.length.
 * Other occurrences keep their order, including chance seeds and repeated !/@. */
export function setMiniMark(
  doc: Doc,
  id: string,
  path: MiniPath,
  index: number,
  mark: MiniMark | null,
) {
  return editMiniStep(doc, id, path, (s) => {
    // Legacy opaque chunks can acquire structure without a document migration.
    let parsed;
    try {
      parsed = s.kind === 'other' && !s.expression ? parseSteps(s.notation)[0] : s;
    } catch {
      return refuse('This stored chunk does not parse; previous values kept');
    }
    if (parsed?.kind !== 'other' || !parsed.expression)
      return refuse('Choose an ordered outer-mark expression');
    const { expression } = parsed;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index > expression.marks.length ||
      (!mark && index === expression.marks.length)
    )
      return refuse('That mark occurrence no longer exists');
    const marks = [...expression.marks];
    marks.splice(index, index === marks.length ? 0 : 1, ...(mark ? [structuredClone(mark)] : []));
    const next = { ...parsed, expression: { ...expression, marks } };
    return safeMini(next) ? next : refuse('Unproven mark or numeric pattern; previous values kept');
  });
}
