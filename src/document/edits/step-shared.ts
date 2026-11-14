import { findWithPath, replaceAtPath, type Refusal } from './shared';
import type { Doc, Pattern, Setting, Step } from '../types';
import { parseSteps, printSteps, printExpression } from '../../import/mini';
import { safeMini } from './mini-shared';
export const refuse = (reason: string): Refusal => ({ ok: false, reason });
export function sequenceOwner(doc: Doc, id: string) {
  if (!id.endsWith(':rhythm')) {
    const found = valueSetting(doc, id);
    return (
      found && {
        ...found,
        core: found.node.value.core,
        corePath: [...found.path, 'value', 'core'],
        control: found.node.name,
      }
    );
  }
  const found = findWithPath(doc, id.slice(0, -7));
  if (!found || !('core' in found.node)) return;
  const pattern = found.node as Pattern,
    core = pattern.core;
  if (core.kind === 'sequence')
    return { ...found, core, corePath: [...found.path, 'core'], control: 'note' };
  if (core.kind !== 'generator' || !['note', 'n', 's', 'sound', 'freq'].includes(core.name)) return;
  const arg = core.args[0];
  if (arg?.kind !== 'pattern') return;
  return {
    ...found,
    core: arg.pattern.core,
    corePath: [...found.path, 'core', 'args', 0, 'pattern', 'core'],
    control: core.name,
  };
}
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
  const found = sequenceOwner(doc, id),
    core = found?.core;
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
  return replaceAtPath(doc, found.corePath, { ...core, steps, notation });
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

/** Addresses relative to core.steps, with real serialized property names.
 * The existing number[] API intentionally remains limited to ordinary groups. */
export type MiniPath = readonly (string | number)[];
export type MiniChildRole =
  | 'subject'
  | 'hits'
  | 'steps'
  | 'rotation'
  | 'faster'
  | 'slower'
  | 'candidate'
  | 'lane'
  | 'part'
  | 'per';
export function stepChildren(s: Step): { role: MiniChildRole; path: MiniPath; step: Step }[] {
  if (s.kind === 'euclid')
    return [
      { role: 'subject', path: ['step'], step: s.step },
      { role: 'hits', path: ['pulses'], step: s.pulses },
      { role: 'steps', path: ['steps'], step: s.steps },
      ...(s.rotation ? [{ role: 'rotation' as const, path: ['rotation'], step: s.rotation }] : []),
    ];
  if (s.kind === 'other')
    return s.expression
      ? [
          { role: 'subject', path: ['expression', 'step'], step: s.expression.step },
          ...s.expression.marks.flatMap((m, i) =>
            m.name === 'faster' || m.name === 'slower'
              ? [{ role: m.name, path: ['expression', 'marks', i, 'amount'], step: m.amount }]
              : [],
          ),
        ]
      : [];
  if (!('steps' in s)) return [];
  return [
    ...s.steps.map((step, i) => ({
      role: (s.kind === 'choose'
        ? 'candidate'
        : s.kind === 'polymeter'
          ? 'lane'
          : 'part') as MiniChildRole,
      path: ['steps', i],
      step,
    })),
    ...(s.kind === 'polymeter' && s.per
      ? [{ role: 'per' as const, path: ['per'], step: s.per }]
      : []),
  ];
}
export function miniStepAt(steps: Step[], path: MiniPath): Step | undefined {
  const first = path[0];
  if (typeof first !== 'number' || !Number.isInteger(first) || first < 0) return;
  let s = steps[first],
    tail = path.slice(1);
  while (s && tail.length) {
    const child = stepChildren(s).find((c) => c.path.every((key, i) => tail[i] === key));
    if (!child) return;
    s = child.step;
    tail = tail.slice(child.path.length);
  }
  return s;
}
/** Copies only the selected branch. Recheck numeric parents after a nested edit. */
export function editMiniStep(
  doc: Doc,
  id: string,
  path: MiniPath,
  edit: (s: Step) => Step | Refusal,
): Doc | Refusal {
  const first = path[0];
  if (typeof first !== 'number' || !Number.isInteger(first) || first < 0)
    return refuse('Choose an existing part');
  return editList(doc, id, [], (steps) => {
    function descend(s: Step | undefined, tail: MiniPath): Step | Refusal {
      if (!s) return refuse('That mini part no longer exists');
      if (!tail.length) {
        const next = edit(s);
        return !('ok' in next) && next !== s && next.kind === 'other' && next.expression
          ? { ...next, notation: printExpression(next.expression) }
          : next;
      }
      const child = stepChildren(s).find((c) => c.path.every((key, i) => tail[i] === key));
      if (!child) return refuse('That mini child role no longer exists');
      const next = descend(child.step, tail.slice(child.path.length));
      if ('ok' in next || next === child.step) return 'ok' in next ? next : s;
      function copy(value: unknown, depth: number): unknown {
        if (depth === child!.path.length) return next;
        const key = child!.path[depth],
          old = value as Record<string | number, unknown>;
        const result = Array.isArray(value) ? [...value] : { ...old };
        (result as Record<string | number, unknown>)[key] = copy(old[key], depth + 1);
        return result;
      }
      if (child.role === 'lane' && next.kind !== 'sub')
        return refuse('Keep this lane as a sequence');
      const result = copy(s, 0) as Step;
      if (
        (s.kind === 'euclid' && child.role !== 'subject') ||
        child.role === 'per' ||
        (s.kind === 'other' && child.role !== 'subject')
      ) {
        if (!safeMini(result))
          return refuse('Unproven numeric pattern; previous values kept. Edit as source');
      }
      if (result.kind === 'other' && result.expression)
        result.notation = printExpression(result.expression);
      return result;
    }
    const next = descend(steps[first], path.slice(1));
    return 'ok' in next
      ? next
      : next === steps[first]
        ? steps
        : steps.map((s, i) => (i === first ? next : s));
  });
}
