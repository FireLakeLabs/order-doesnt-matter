import type { Arg, Doc } from '../types';
import { parseSteps } from '../../import/mini';
import { replaceAtPath, type Refusal } from './shared';
import { rewriteOwner } from './rewrite-shared';
export function setRewriteArgument(
  doc: Doc,
  id: string,
  index: number,
  value: number | string,
): Doc | Refusal {
  const owner = rewriteOwner(doc, id),
    arg = owner?.layer.args[index];
  if (!owner || !arg) return { ok: false, reason: 'This rewrite argument no longer exists' };
  const pattern = arg.kind === 'pattern' && !arg.pattern.layers.length ? arg.pattern : undefined;
  const core = pattern?.core;
  const old =
    arg.kind === 'literal'
      ? arg.value
      : core?.kind === 'constant'
        ? core.value
        : core?.kind === 'sequence'
          ? core.notation
          : undefined;
  if ((typeof old !== 'number' && typeof old !== 'string') || typeof old !== typeof value)
    return { ok: false, reason: 'This argument is edited as source for now' };
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) ||
      (['fast', 'slow', 'segment'].includes(owner.layer.name) && value <= 0))
  )
    return {
      ok: false,
      reason: 'Use a finite number; time factors and sampling rates must be positive',
    };
  let next: Arg;
  if (typeof value === 'string') {
    try {
      const steps = parseSteps(value);
      next = pattern
        ? {
            ...arg,
            kind: 'pattern',
            pattern: { ...pattern, core: { kind: 'sequence', notation: value, steps } },
          }
        : { ...arg, kind: 'literal', value };
    } catch {
      return {
        ok: false,
        reason: 'This pattern could not be parsed. Check its brackets and values.',
      };
    }
  } else
    next = pattern
      ? { ...arg, kind: 'pattern', pattern: { ...pattern, core: { kind: 'constant', value } } }
      : { ...arg, kind: 'literal', value };
  if (value === old) return doc;
  return replaceAtPath(doc, [...owner.path, 'layers', owner.index, 'args', index], next);
}
