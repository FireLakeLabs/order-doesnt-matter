import type { Doc } from '../types';
import { parseSteps, printSteps } from '../../import/mini';
import { editStep, refuse } from './values-shared';
/** The saved value is mini text so repeats/chance survive switching off too. */
export function toggleRest(doc: Doc, id: string, path: number[]) {
  return editStep(doc, id, path, (s) => {
    if (s.kind === 'value') {
      const weight = s.weight ?? s.repeat;
      return { kind: 'rest', was: printSteps([s]), ...(weight === undefined ? {} : { weight }) };
    }
    if (s.kind !== 'rest') return refuse('Only individual values can be switched off');
    try {
      const saved = parseSteps(s.was ?? '1');
      if (saved.length !== 1 || saved[0].kind !== 'value')
        return refuse('The saved value is not an individual value');
      const value = saved[0],
        weight = value.weight ?? value.repeat;
      return s.weight === weight
        ? value
        : { ...value, ...(s.weight === undefined ? {} : { weight: s.weight }) };
    } catch {
      return refuse('The saved value does not parse');
    }
  });
}
