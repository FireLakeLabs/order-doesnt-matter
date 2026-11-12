import type { Step } from '../types';
import { parseSteps, printSteps } from '../../import/mini';
export type Mark = 'repeat' | 'faster' | 'slower' | 'weight';
const symbols = { repeat: '!', faster: '*', slower: '/', weight: '@' } as const;
export function rhythmNumber(text: string): number {
  const parts = text.trim().split('/');
  return parts.length <= 2 && parts.every((p) => /^-?\d+(?:\.\d+)?$/.test(p))
    ? Number(parts[0]) / (parts.length === 2 ? Number(parts[1]) : 1)
    : NaN;
}
/** Read only literal outer marks. Pattern-valued rates and unknown chunks stay source. */
function readMarks(s: Step) {
  if (s.kind !== 'other' && !('weight' in s) && !(s.kind === 'value' && s.repeat !== undefined)) {
    return ['value', 'rest', 'sub', 'alternate', 'together', 'euclid'].includes(s.kind)
      ? { base: s, ops: [] as { name: Mark; amount: number }[], weight: 1 }
      : undefined;
  }
  let text = printSteps([s]);
  const ops: { name: Mark; amount: number }[] = [];
  for (;;) {
    const match = text.match(/^(.*)([!*/@])(-?\d+(?:\.\d+)?)?$/s);
    if (!match) break;
    const name = (Object.keys(symbols) as Mark[]).find((k) => symbols[k] === match[2])!;
    if (!match[3] && (name === 'faster' || name === 'slower')) return;
    ops.unshift({ name, amount: Number(match[3] ?? 2) });
    text = match[1];
  }
  const base = parseSteps(text);
  if (
    base.length !== 1 ||
    !['value', 'rest', 'sub', 'alternate', 'together', 'euclid'].includes(base[0].kind)
  )
    return;
  if (
    ops.some(
      (op, i) =>
        !Number.isFinite(op.amount) ||
        (op.name !== 'weight' && op.amount <= 0) ||
        ops.slice(0, i).some((p) => p.name === op.name),
    )
  )
    return;
  let weight = 1;
  for (const op of ops) {
    if (op.name === 'repeat') weight = op.amount;
    if (op.name === 'weight') weight += op.amount - 1;
  }
  return weight > 0 && Number.isFinite(weight) ? { base: base[0], ops, weight } : undefined;
}
export function printRhythmMarks(base: Step, ops: { name: Mark; amount: number }[]) {
  return parseSteps(
    printSteps([base]) + ops.map((op) => `${symbols[op.name]}${op.amount}`).join(''),
  )[0];
}

// Document edits are immutable; playback updates can reuse the same decoded marks.
const decoded = new WeakMap<Step, ReturnType<typeof readMarks>>();
export function rhythmMarks(s: Step) {
  if (!decoded.has(s)) {
    try {
      decoded.set(s, readMarks(s));
    } catch {
      decoded.set(s, undefined);
    }
  }
  return decoded.get(s);
}
