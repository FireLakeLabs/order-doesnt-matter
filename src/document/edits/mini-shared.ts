import type { MiniMark, Step } from '../types';
/** Finite, bounded numeric patterns whose mini semantics have engine canaries.
 * Randomness, rests, stacked values, and opaque arguments remain source. */
export function numericMini(
  s: Step,
  min: number,
  max: number,
  integer = false,
): number[] | undefined {
  if (s.kind === 'value' && s.repeat === undefined && s.chance === undefined) {
    const n = Number(s.value);
    if (
      /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s.value) &&
      Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!integer || Number.isSafeInteger(n)) &&
      (s.weight === undefined || (s.weight > 0 && s.weight <= 1024))
    )
      return [n];
  }
  if (
    (s.kind === 'sub' || s.kind === 'alternate') &&
    s.steps.length &&
    s.steps.length <= 128 &&
    (!('weight' in s) || s.weight === undefined || (s.weight > 0 && s.weight <= 1024))
  ) {
    const values = s.steps.map((child) => numericMini(child, min, max, integer));
    if (values.every((v) => v !== undefined)) return values.flat();
  }
}
export function safeMiniMark(m: MiniMark): boolean {
  if (m.name === 'faster' || m.name === 'slower') return !!numericMini(m.amount!, 1 / 1024, 1024);
  const n = m.amount ?? (m.name === 'chance' ? 0.5 : 2);
  return (
    typeof n === 'number' &&
    Number.isFinite(n) &&
    (m.name === 'chance'
      ? n >= 0 && n <= 1
      : m.name === 'repeat'
        ? Number.isSafeInteger(n) && n >= 1 && n <= 1024
        : Math.abs(n) <= 1024)
  );
}
export function safeMini(s: Step): boolean {
  if (s.kind === 'other') {
    if (!s.expression || !safeMini(s.expression.step) || !s.expression.marks.every(safeMiniMark))
      return false;
    let weight = 1,
      repeats = 1;
    for (const m of s.expression.marks) {
      if (m.name === 'repeat') {
        repeats += ((m.amount as number) ?? 2) - 1;
        weight = repeats;
      }
      if (m.name === 'weight') weight += ((m.amount as number) ?? 2) - 1;
    }
    return weight > 0 && weight <= 1024;
  }
  if (s.kind === 'euclid') {
    const hits = numericMini(s.pulses, -1024, 1024, true),
      steps = numericMini(s.steps, 1, 1024, true);
    return (
      !!hits &&
      !!steps &&
      Math.max(...hits.map(Math.abs)) <= Math.min(...steps) &&
      (!s.rotation || !!numericMini(s.rotation, -1024, 1024, true)) &&
      safeMini(s.step)
    );
  }
  if (s.kind === 'polymeter')
    return (
      s.steps.length > 0 &&
      s.steps.every((lane) => lane.kind === 'sub' && safeMini(lane)) &&
      (!s.per ||
        (s.per.kind === 'value' &&
          Object.keys(s.per).length === 2 &&
          !!numericMini(s.per, 1 / 1024, 1024)))
    );
  if ('steps' in s)
    return (
      s.steps.length <= 128 &&
      s.steps.length >= (s.kind === 'choose' ? 2 : 1) &&
      s.steps.every(safeMini)
    );
  if (
    s.kind === 'value' &&
    ((s.repeat !== undefined &&
      (!Number.isSafeInteger(s.repeat) || s.repeat < 1 || s.repeat > 1024)) ||
      (s.chance !== undefined && (!Number.isFinite(s.chance) || s.chance < 0 || s.chance > 1)))
  )
    return false;
  return (
    !('weight' in s) ||
    s.weight === undefined ||
    (Number.isFinite(s.weight) && s.weight > 0 && s.weight <= 1024)
  );
}
