import type { Doc, Step } from '../types';
import { editStep, refuse } from './step-shared';
import { rhythmMarks, printRhythmMarks } from './rhythm-marks';
export function euclidNumbers(s: Step) {
  if (s.kind !== 'euclid') return;
  const number = (v?: Step) =>
    v?.kind === 'value' && Object.keys(v).length === 2 && /^-?\d+$/.test(v.value)
      ? Number(v.value)
      : NaN;
  const hits = number(s.pulses),
    outOf = number(s.steps),
    turn = s.rotation ? number(s.rotation) : 0;
  if (
    ![hits, outOf, turn].every(Number.isSafeInteger) ||
    hits < 0 ||
    outOf < 1 ||
    hits > outOf ||
    outOf > 1024
  )
    return;
  return { hits, outOf, turn };
}
export function euclidRhythm(
  doc: Doc,
  id: string,
  path: number[],
  hits: number | null,
  outOf = 8,
  turn = 0,
) {
  if (
    hits !== null &&
    (![hits, outOf, turn].every(Number.isSafeInteger) ||
      hits < 0 ||
      outOf < 1 ||
      hits > outOf ||
      outOf > 1024)
  )
    return refuse('Use whole numbers: hits from 0 to out of, out of from 1 to 1024');
  return editStep(doc, id, path, (step) => {
    const marks = rhythmMarks(step),
      s = marks?.base ?? step;
    const marked = (next: Step) => (marks?.ops.length ? printRhythmMarks(next, marks.ops) : next);
    if (s.kind === 'euclid' && !euclidNumbers(s))
      return refuse('Edit these changing numbers as source');
    if (hits === null)
      return s.kind === 'euclid' ? marked(s.step) : refuse('Choose evenly spread hits');
    if (
      (s.kind === 'value' && Object.keys(s).length !== 2) ||
      (s.kind !== 'value' && s.kind !== 'euclid')
    )
      return refuse('Choose one note or sound');
    const literal = (value: number): Step => ({ kind: 'value', value: String(value) });
    return marked({
      kind: 'euclid',
      step: s.kind === 'euclid' ? s.step : s,
      pulses: literal(hits),
      steps: literal(outOf),
      rotation: literal(turn),
    });
  });
}
