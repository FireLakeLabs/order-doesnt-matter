import type { Doc, Step } from '../types';
import { parseSteps } from '../../import/mini';
import { editList, editMiniStep, refuse, type MiniPath } from './step-shared';
import { safeMini } from './mini-shared';
/** Explicit list splice. Polymeter entries are sub lanes; choice entries are candidates.
 * A multi-value candidate/lane is supplied in brackets. No automatic flattening. */
export function spliceMiniSteps(
  doc: Doc,
  id: string,
  path: MiniPath,
  index: number,
  count: number,
  notation = '',
) {
  let added: Step[];
  try {
    added = notation.trim() ? parseSteps(notation) : [];
  } catch {
    return refuse('This mini list does not parse; previous values kept');
  }
  if (!added.every(safeMini)) return refuse('Unproven mini parts stay source');
  const splice = (steps: Step[], minimum = 1, lanes = false) => {
    if (
      !Number.isInteger(index) ||
      !Number.isInteger(count) ||
      index < 0 ||
      count < 0 ||
      index > steps.length ||
      count > steps.length - index ||
      steps.length - count + added.length < minimum ||
      (lanes && added.some((s) => s.kind !== 'sub'))
    )
      return refuse('Choose existing parts and keep the required lanes or candidates');
    return count === 0 && !added.length
      ? steps
      : [...steps.slice(0, index), ...added, ...steps.slice(index + count)];
  };
  if (!path.length) return editList(doc, id, [], splice);
  if (path.at(-1) !== 'steps') return refuse('Choose a stored steps list');
  return editMiniStep(doc, id, path.slice(0, -1), (s) => {
    if (!('steps' in s) || s.kind === 'euclid') return refuse('Choose a stored steps list');
    const steps = splice(s.steps, s.kind === 'choose' ? 2 : 1, s.kind === 'polymeter');
    return 'ok' in steps ? steps : steps === s.steps ? s : { ...s, steps };
  });
}
