import type { Path } from './index';
import { printSteps } from '../import/mini';
import type { Pattern, Step } from './types';
// Presentation and identity never decide whether two content addresses agree.
const metadata = new Set(['id', 'span', 'tier', 'role', 'label', 'comment', 'origin', 'muted']);
const ignored = (node: object, key: string) =>
  ('id' in node && ('tier' in node || 'pattern' in node) && metadata.has(key)) ||
  ('kind' in node && node.kind === 'sequence' && key === 'notation');
export function content(value: unknown, literal = false): unknown {
  if (Array.isArray(value)) return value.map((v) => content(v, literal));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => literal || !ignored(value, key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [
        key,
        content(
          child,
          literal ||
            (key === 'value' &&
              'kind' in value &&
              ['literal', 'data'].includes(String(value.kind))),
        ),
      ]),
  );
}
export const sameContent = (a: unknown, b: unknown) =>
  JSON.stringify(content(a)) === JSON.stringify(content(b));
export function at(value: unknown, path: Path): unknown {
  for (const key of path) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}
export interface ContentChange {
  path: Path;
  before: unknown;
  after: unknown;
  splice?: { index: number; length: number; total: number };
  order?: number[];
}
/** Steps are edit addresses; notation is regenerated from their resulting tree. */
export function contentChanges(before: unknown, after: unknown, path: Path = []): ContentChange[] {
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    const order = after.map((item) => before.indexOf(item));
    if (
      order.every((i) => i >= 0) &&
      new Set(order).size === before.length &&
      order.some((i, at) => i !== at)
    )
      return [{ path, before, after, order }];
  }
  if (sameContent(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after) && before.length !== after.length) {
    let first = 0,
      tail = 0;
    while (
      first < Math.min(before.length, after.length) &&
      sameContent(before[first], after[first])
    )
      first++;
    while (
      tail < Math.min(before.length, after.length) - first &&
      sameContent(before[before.length - 1 - tail], after[after.length - 1 - tail])
    )
      tail++;
    return [
      {
        path,
        before: before.slice(first, before.length - tail),
        after: after.slice(first, after.length - tail),
        splice: { index: first, length: before.length - first - tail, total: before.length },
      },
    ];
  }
  if (
    Array.isArray(before) &&
    Array.isArray(after) &&
    before.length === after.length &&
    !before.some(
      (n, i) => n?.id && after.some((item) => item?.id === n.id) && n.id !== after[i]?.id,
    )
  )
    return before.flatMap((n, i) => contentChanges(n, after[i], [...path, i]));
  if (
    before &&
    after &&
    typeof before === 'object' &&
    typeof after === 'object' &&
    !Array.isArray(before) &&
    !Array.isArray(after) &&
    !(
      'kind' in before &&
      (before.kind !== (after as { kind?: string }).kind ||
        ['data', 'literal'].includes(String(before.kind)))
    ) &&
    !(
      path.at(-2) === 'steps' &&
      typeof path.at(-1) === 'number' &&
      !('steps' in before && Array.isArray(before.steps))
    )
  ) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((k) => !ignored(before, k))
      .flatMap((k) => contentChanges(a[k], b[k], [...path, k]));
  }
  return [{ path, before, after }];
}
export function refreshNotation(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if ('kind' in value && value.kind === 'sequence' && 'steps' in value)
    (value as Pattern['core'] & { notation: string }).notation = printSteps(value.steps as Step[]);
  if ('kind' in value && ['literal', 'data'].includes(String(value.kind))) return;
  for (const child of Object.values(value)) refreshNotation(child);
}
