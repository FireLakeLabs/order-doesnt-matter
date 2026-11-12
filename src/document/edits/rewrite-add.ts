import { instruments, type Doc, type Pattern, type RewriteLayer } from '../index';
import { patternMethods } from '../../import/registry';
import { freshIds, replaceNode, type Refusal } from './shared';
const choices = [
  ['fast', 'Fit the score into less time.', [1]],
  ['slow', 'Spread the score over more time.', [1]],
  ['rev', 'Reverse the score within each cycle.', []],
  ['palindrome', 'Alternate forward and reversed cycles.', []],
  ['ply', 'Repeat each note within its span.', [1]],
  ['degradeBy', 'Leave out a proportion of notes.', [0]],
  ['early', 'Place notes earlier by this many cycles.', [0]],
  ['late', 'Place notes later by this many cycles.', [0]],
  ['euclid', 'Distribute pulses across a number of steps.', [1, 1]],
  ['segment', 'Sample the score this many times per cycle.', [1]],
] as const;
export const rewriteChoices = choices
  .filter(([name]) => patternMethods.has(name))
  .map(([name, description, defaults]) => ({ name, description, defaults }));
/** New layers append to the instrument definition, never to a setting or a use. */
export function addRewrite(doc: Doc, patternId: string, name: string): Doc | Refusal {
  const row = instruments(doc).find((r) => r.pattern.id === patternId);
  const choice = rewriteChoices.find((c) => c.name === name);
  if (!row || !choice) return { ok: false, reason: 'Choose an instrument and a listed rewrite' };
  const layer: RewriteLayer = {
    id: freshIds(doc)('rewrite'),
    tier: 1,
    kind: 'rewrite',
    name,
    args: choice.defaults.map((value) => ({ kind: 'literal', value })),
  };
  const pattern: Pattern = { ...row.pattern, layers: [...row.pattern.layers, layer] };
  return replaceNode(doc, patternId, pattern);
}
