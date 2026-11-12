import type { Step } from '../types';
import { isGroup } from './step-shared';
export type Fraction = [number, number];
export interface Box {
  start: Fraction;
  end: Fraction;
  depth: number;
  kind: Step['kind'];
  path: number[];
  value?: string;
  /** Zero based turn within the nearest alternatives group. */
  turn?: number;
  active: boolean;
  opaque?: boolean;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
const fraction = (n: number, d = 1): Fraction => {
  const divisor = gcd(n, d);
  return [n / divisor, d / divisor];
};
// The pinned mini parser computes @ with floating addition/subtraction.
// Recover its rational value (as Strudel does), e.g. 0.10000000000000009 → 1/10.
const rational = (n: number): Fraction => {
  let x = n,
    h = 1,
    previousH = 0,
    k = 0,
    previousK = 1;
  for (let i = 0; i < 32; i++) {
    const a = Math.floor(x),
      nextH = a * h + previousH,
      nextK = a * k + previousK;
    previousH = h;
    h = nextH;
    previousK = k;
    k = nextK;
    if (Math.abs(h / k - n) < 1e-12) break;
    x = 1 / (x - a);
  }
  return fraction(h, k);
};
const add = (a: Fraction, b: Fraction) => fraction(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const mul = (a: Fraction, b: Fraction) => fraction(a[0] * b[0], a[1] * b[1]);
export const fractionNumber = (a: Fraction) => a[0] / a[1];
const weight = (s: Step) =>
  ('weight' in s ? s.weight : undefined) ?? (s.kind === 'value' ? s.repeat : undefined) ?? 1;
/** One absolute cycle. Opaque chunks occupy their structural slot, without invented notes.
 * Alternatives retain all turns for editing; active marks the turn that plays.
 */
export function layoutRhythm(steps: Step[], cycle = 0): Box[] {
  // `other` can hide an outer weight; weighted alternatives can span cycles.
  // Neither is safe to give ordinary one-cycle slots from the stored tree.
  const unresolved = (s: Step): boolean =>
    s.kind === 'other' ||
    !Number.isFinite(weight(s)) ||
    weight(s) <= 0 ||
    (isGroup(s) &&
      ((s.kind === 'alternate' && s.steps.some((c) => weight(c) !== 1)) ||
        s.steps.some(unresolved)));
  if (steps.some(unresolved))
    return [
      {
        start: [cycle, 1],
        end: [cycle + 1, 1],
        depth: -1,
        kind: 'other',
        path: [],
        active: true,
        opaque: true,
      },
    ];
  const boxes: Box[] = [];
  function list(
    items: Step[],
    start: Fraction,
    duration: Fraction,
    path: number[],
    localCycle: number,
    active: boolean,
    turn?: number,
  ) {
    const total = items.reduce((sum, s) => add(sum, rational(weight(s))), [0, 1] as Fraction);
    let offset: Fraction = [0, 1];
    items.forEach((s, i) => {
      const share = mul(duration, mul(rational(weight(s)), [total[1], total[0]]));
      part(s, add(start, offset), share, [...path, i], localCycle, active, turn);
      offset = add(offset, share);
    });
  }
  function part(
    s: Step,
    start: Fraction,
    duration: Fraction,
    path: number[],
    localCycle: number,
    active: boolean,
    turn?: number,
  ) {
    const opaque =
      !['value', 'rest', 'sub', 'alternate', 'together'].includes(s.kind) ||
      (s.kind === 'value' && s.chance !== undefined);
    const box: Box = {
      start,
      end: add(start, duration),
      depth: path.length - 1,
      kind: opaque && s.kind === 'value' ? 'other' : s.kind,
      path,
      active,
      ...(turn === undefined ? {} : { turn }),
      ...(opaque ? { opaque: true } : {}),
    };
    if (s.kind === 'value' && !opaque) {
      const repeats = s.repeat ?? 1;
      for (let i = 0; i < repeats; i++) {
        const span = mul(duration, fraction(1, repeats)),
          a = add(start, mul(span, fraction(i)));
        boxes.push({ ...box, start: a, end: add(a, span), value: s.value });
      }
    } else boxes.push(box);
    if (opaque || !isGroup(s)) return;
    if (s.kind === 'sub') list(s.steps, start, duration, path, localCycle, active, turn);
    else
      s.steps.forEach((child, i) =>
        part(
          child,
          start,
          duration,
          [...path, i],
          s.kind === 'alternate' ? Math.floor(localCycle / s.steps.length) : localCycle,
          active &&
            (s.kind !== 'alternate' ||
              ((localCycle % s.steps.length) + s.steps.length) % s.steps.length === i),
          s.kind === 'alternate' ? i : turn,
        ),
      );
  }
  list(steps, [cycle, 1], [1, 1], [], cycle, true);
  return boxes;
}
