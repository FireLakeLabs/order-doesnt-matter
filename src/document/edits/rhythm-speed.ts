import type { Doc } from '../types';
import { editStep, refuse } from './step-shared';
import { rhythmMarks, printRhythmMarks, type Mark } from './rhythm-marks';
export function speedRhythm(
  doc: Doc,
  id: string,
  path: number[],
  name: Mark,
  value: number | null,
) {
  if (
    value !== null &&
    (!Number.isFinite(value) || value <= 0 || (name === 'repeat' && !Number.isSafeInteger(value)))
  )
    return refuse('Use a positive number; repeats need a whole number');
  return editStep(doc, id, path, (s) => {
    const marks = rhythmMarks(s);
    if (!marks) return refuse('Edit this chunk as source');
    if (value === null && !marks.ops.some((op) => op.name === name)) return s;
    const ops = marks.ops.filter((op) => op.name !== name);
    if (value !== null) {
      // Length is the effective share, including the weight that repeat adds.
      const amount =
        name === 'weight'
          ? value - (ops.find((op) => op.name === 'repeat')?.amount ?? 1) + 1
          : value;
      const index = marks.ops.findIndex((op) => op.name === name);
      ops.splice(name === 'weight' || index < 0 ? ops.length : index, 0, { name, amount });
    }
    try {
      return printRhythmMarks(marks.base, ops);
    } catch {
      return refuse('This number cannot be stored as a literal mark');
    }
  });
}
