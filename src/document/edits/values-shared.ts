import { findWithPath, replaceAtPath, type Refusal } from './shared';
import type { Doc, Setting, Step } from '../types';
import { parseSteps, printSteps } from '../../import/mini';
export const refuse = (reason: string): Refusal => ({ ok: false, reason });
export function valueSetting(doc: Doc, id: string) {
  const found = findWithPath(doc, id);
  return found && 'value' in found.node && 'name' in found.node
    ? { ...found, node: found.node as Setting }
    : undefined;
}
export const isGroup = (s: Step): s is Extract<Step, { kind: 'sub' | 'alternate' | 'together' }> =>
  ['sub', 'alternate', 'together'].includes(s.kind);
export function atom(value: string): Step | Refusal {
  try {
    const steps = parseSteps(value);
    if (
      steps.length === 1 &&
      steps[0].kind === 'value' &&
      steps[0].value === value &&
      !Object.keys(steps[0]).some((k) => !['kind', 'value'].includes(k))
    )
      return steps[0];
  } catch {
    /* Report parse failures as values. */
  }
  return refuse('Enter one value, without pattern punctuation');
}
/** Paths are re-resolved against the current setting on every edit. */
export function editList(
  doc: Doc,
  id: string,
  path: number[],
  edit: (steps: Step[]) => Step[] | Refusal,
): Doc | Refusal {
  const found = valueSetting(doc, id),
    core = found?.node.value.core;
  if (!found || core?.kind !== 'sequence')
    return refuse('This setting has no editable value pattern');
  function descend(steps: Step[], depth: number): Step[] | Refusal {
    if (depth === path.length) return edit(steps);
    const i = path[depth],
      s = steps[i];
    if (!Number.isInteger(i) || i < 0 || !s || !isGroup(s))
      return refuse('That value group no longer exists');
    const next = descend(s.steps, depth + 1);
    if ('ok' in next) return next;
    return next === s.steps
      ? steps
      : steps.map((old, j) => (j === i ? { ...s, steps: next } : old));
  }
  const steps = descend(core.steps, 0);
  if ('ok' in steps) return steps;
  if (steps === core.steps) return doc;
  const notation = printSteps(steps);
  try {
    parseSteps(notation);
  } catch {
    return refuse('This pattern does not parse; previous values kept');
  }
  return replaceAtPath(doc, [...found.path, 'value', 'core'], { ...core, steps, notation });
}
export function editStep(
  doc: Doc,
  id: string,
  path: number[],
  edit: (step: Step) => Step | Refusal,
): Doc | Refusal {
  const i = path.at(-1);
  if (i === undefined || !Number.isInteger(i) || i < 0) return refuse('Choose an existing value');
  return editList(doc, id, path.slice(0, -1), (steps) => {
    if (!steps[i]) return refuse('That value no longer exists');
    const next = edit(steps[i]);
    return 'ok' in next
      ? next
      : next === steps[i]
        ? steps
        : steps.map((s, j) => (j === i ? next : s));
  });
}
