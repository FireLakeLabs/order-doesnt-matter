import type { Doc, Step } from '../types';
import { parseSteps, printSteps } from '../../import/mini';
import { replaceAtPath } from './shared';
import { atom, isGroup, refuse, valueSetting } from './values-shared';
export function convertValues(doc: Doc, id: string, to: 'values' | 'constant') {
  const found = valueSetting(doc, id),
    core = found?.node.value.core;
  if (!found || !core || found.node.value.layers.length)
    return refuse('Only an unlayered value setting can change form here');
  if (to === 'values' && core.kind === 'constant' && typeof core.value !== 'boolean') {
    const value = atom(String(core.value));
    if ('ok' in value) return value;
    const steps: Step[] = [{ kind: 'alternate', steps: [value, { ...value }] }];
    return replaceAtPath(doc, [...found.path, 'value', 'core'], {
      kind: 'sequence',
      steps,
      notation: printSteps(steps),
    });
  }
  function first(steps: Step[]): string | undefined {
    for (const s of steps) {
      if (s.kind === 'value') return s.value;
      if (s.kind === 'rest' && s.was) {
        try {
          const saved = parseSteps(s.was);
          if (saved[0]?.kind === 'value') return saved[0].value;
        } catch {
          /* Try the next enabled value. */
        }
      }
      if (s.kind === 'euclid') {
        const v = first([s.step]);
        if (v !== undefined) return v;
      }
      if (isGroup(s) || s.kind === 'choose' || s.kind === 'polymeter') {
        const v = first(s.steps);
        if (v !== undefined) return v;
      }
    }
  }
  const value = core.kind === 'sequence' ? first(core.steps) : undefined;
  if (to !== 'constant' || value === undefined)
    return refuse('No individual value is available to keep');
  return replaceAtPath(doc, [...found.path, 'value', 'core'], {
    kind: 'constant',
    value: value.trim() && Number.isFinite(Number(value)) ? Number(value) : value,
  });
}
