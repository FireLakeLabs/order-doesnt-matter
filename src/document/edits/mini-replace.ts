import type { Doc } from '../types';
import { parseSteps } from '../../import/mini';
import { editMiniStep, refuse, type MiniPath } from './step-shared';
import { safeMini } from './mini-shared';
/** Replace one lane, candidate, value, or numeric argument; never splice siblings. */
export function replaceMiniStep(doc: Doc, id: string, path: MiniPath, notation: string) {
  try {
    const steps = parseSteps(notation);
    if (steps.length !== 1 || !safeMini(steps[0]))
      return refuse('Use one supported mini part; unproven forms stay source');
    return editMiniStep(doc, id, path, (s) =>
      JSON.stringify(s) === JSON.stringify(steps[0]) ? s : steps[0],
    );
  } catch {
    return refuse('This mini part does not parse; previous values kept');
  }
}
