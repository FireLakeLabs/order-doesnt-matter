import type { Doc, Arg } from '../types';
import { parseSteps } from '../../import/mini';
import { replaceAtPath } from './shared';
import { replaceOpaque } from './source-opaque';
import { callAt, refusal } from './source-shared';
export function setGenericArgument(doc: Doc, id: string, index: number, text: string) {
  const call = callAt(doc, id),
    arg = call?.args[index];
  if (!call || !arg) return refusal('This argument no longer exists.');
  const pattern = arg.kind === 'pattern' && !arg.pattern.layers.length ? arg.pattern : undefined;
  const core = pattern?.core;
  const value =
    arg.kind === 'literal'
      ? arg.value
      : core?.kind === 'constant'
        ? core.value
        : core?.kind === 'sequence'
          ? core.notation
          : undefined;
  let next: Arg;
  if (typeof value === 'number') {
    const number = Number(text);
    if (!text.trim() || !Number.isFinite(number)) return refusal('Enter a finite number.');
    if (number === value) return doc;
    next = pattern
      ? {
          ...arg,
          kind: 'pattern',
          pattern: { ...pattern, core: { kind: 'constant', value: number } },
        }
      : { ...arg, kind: 'literal', value: number };
  } else if (typeof value === 'string') {
    try {
      const steps = pattern ? parseSteps(text) : [];
      if (text === value) return doc;
      next = pattern
        ? {
            ...arg,
            kind: 'pattern',
            pattern: { ...pattern, core: { kind: 'sequence', steps, notation: text } },
          }
        : { ...arg, kind: 'literal', value: text };
    } catch {
      return refusal('Check the pattern’s brackets and values.');
    }
  } else if (arg.kind === 'opaque') {
    // Source replacement validates both this expression and its whole-program position.
    return replaceOpaque(doc, `${id}:arg:${index}`, text);
  } else return refusal('Open this pattern or edit the whole call as source text.');
  return replaceAtPath(doc, [...call.path, index], next);
}
