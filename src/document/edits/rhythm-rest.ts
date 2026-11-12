import type { Doc, Step } from '../types';
import { parseSteps, printSteps } from '../../import/mini';
import { editStep, isGroup, refuse } from './step-shared';
/** rest.was stores mini text; do not discard nested rests' saved values. */
export function restRhythm(doc: Doc, id: string, path: number[]) {
  return editStep(doc, id, path, (s) => {
    if (s.kind === 'value') {
      return {
        kind: 'rest',
        was: printSteps([s]),
        ...(s.weight === undefined && s.repeat === undefined
          ? {}
          : { weight: s.weight ?? s.repeat }),
      };
    }
    if (isGroup(s)) {
      const savedRest = (step: Step): boolean =>
        step.kind === 'rest' ? !!step.was : isGroup(step) && step.steps.some(savedRest);
      if (savedRest(s))
        return refuse('This group contains saved rests; switch its parts off individually');
      return { kind: 'rest', was: printSteps([s]), weight: s.kind === 'sub' ? (s.weight ?? 1) : 1 };
    }
    if (s.kind !== 'rest') return refuse('Edit this chunk as source');
    try {
      const saved = parseSteps(s.was ?? '1');
      if (saved.length !== 1) return refuse('The saved part must be one chunk');
      const first = saved[0],
        weight = s.weight ?? 1;
      if (first.kind === 'value' || first.kind === 'sub' || first.kind === 'rest') {
        const original = first.weight ?? (first.kind === 'value' ? first.repeat : undefined) ?? 1;
        return weight === original ? first : { ...first, weight };
      }
      return weight === 1 ? first : { kind: 'sub', weight, steps: [first] };
    } catch {
      return refuse('The saved part does not parse');
    }
  });
}
