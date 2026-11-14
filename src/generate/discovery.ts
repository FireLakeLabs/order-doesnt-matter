import type { Arg, Doc, Pattern, Step } from '../document';

const controls = new Set('s note n bank gain cutoff lpf pan release room delay'.split(' '));
const groups = new Set(['stack', 'arrange']);
const rates = new Set(['fast', 'slow', 'ply']);
const atom = (s: string) => /^[a-zA-Z0-9_]+$/.test(s);
function literalSpeed(s: Extract<Step, { kind: 'other' }>): boolean {
  const match = /^([a-zA-Z0-9_]+)\*([1-9]\d*)$/.exec(s.notation);
  if (!match) return false;
  // Structural editors generate from expression rather than legacy notation.
  // Admit only the canonical AST for this same fixed literal grammar. Extra or
  // reordered metadata conservatively misses, including on older checkouts.
  return (
    !('expression' in s) ||
    s.expression === undefined ||
    JSON.stringify(s.expression) ===
      JSON.stringify({
        step: { kind: 'value', value: match[1] },
        marks: [{ name: 'faster', amount: { kind: 'value', value: match[2] } }],
      })
  );
}
function steps(items: Step[]): boolean {
  return items.every((s) => {
    if (
      'weight' in s &&
      s.weight !== undefined &&
      (typeof s.weight !== 'number' || !Number.isFinite(s.weight))
    )
      return false;
    switch (s.kind) {
      case 'value':
        return (
          atom(s.value) &&
          [s.repeat, s.chance].every(
            (n) => n === undefined || (typeof n === 'number' && Number.isFinite(n)),
          )
        );
      case 'rest':
        return true;
      case 'sub':
      case 'alternate':
      case 'together':
        return steps(s.steps);
      case 'other':
        // The base importer stores Kiln's literal bd*4/hh*16 as other.
        // Admit only this fixed mini token + positive integer speed grammar.
        return literalSpeed(s);
      default:
        return false;
    }
  });
}
function value(p: Pattern): boolean {
  return (
    !p.layers.length &&
    !p.muted &&
    !p.origin &&
    ((p.core.kind === 'constant' &&
      (typeof p.core.value === 'string'
        ? atom(p.core.value)
        : typeof p.core.value === 'boolean' ||
          (typeof p.core.value === 'number' && Number.isFinite(p.core.value)))) ||
      (p.core.kind === 'sequence' && steps(p.core.steps)))
  );
}
const argument = (a: Arg): boolean =>
  (a.kind === 'literal' &&
    ['string', 'number', 'boolean'].includes(typeof a.value) &&
    (typeof a.value === 'string'
      ? atom(a.value)
      : typeof a.value !== 'number' || Number.isFinite(a.value))) ||
  (a.kind === 'pattern' && value(a.pattern));

/** Admission for section inventory only, not arbitrary JS purity. No references
 * in arguments/controls, callbacks, setup, custom calls, signals or data objects.
 * Only numeric constant gain/lpf setters are erased; every other serialized
 * field stays, including IDs/names, asset selectors, tempo, timing and muting.
 * The engine must additionally own a clean registry and a document epoch.
 */
export function discoveryIdentity(doc: Doc): string | undefined {
  const copy = structuredClone(doc);
  const names = new Set<string>();
  function pattern(p: Pattern): boolean {
    const c = p.core;
    const core =
      (c.kind === 'ref' && names.has(c.name)) ||
      (c.kind === 'generator' &&
        ((c.name === 'silence' && !c.args.length) ||
          (['s', 'note', 'n'].includes(c.name) &&
            c.args.length === 1 &&
            c.args.every(argument)))) ||
      (c.kind === 'group' &&
        groups.has(c.how) &&
        c.parts.every(
          (p) =>
            (p.cycles === undefined ||
              (typeof p.cycles === 'number' && Number.isFinite(p.cycles) && p.cycles > 0)) &&
            pattern(p.pattern),
        ));
    return (
      core &&
      p.layers.every((layer) => {
        if (layer.kind === 'rewrite') {
          // Kiln's add(note(24)) changes pitch only; general arithmetic may
          // consume another instrument's gain, so is deliberately excluded.
          if (layer.name === 'add') {
            const a = layer.args[0];
            return (
              layer.args.length === 1 &&
              a.kind === 'pattern' &&
              !a.pattern.layers.length &&
              a.pattern.core.kind === 'generator' &&
              a.pattern.core.name === 'note' &&
              a.pattern.core.args.length === 1 &&
              a.pattern.core.args.every(argument)
            );
          }
          return rates.has(layer.name) && layer.args.length === 1 && layer.args.every(argument);
        }
        if (layer.kind !== 'settings') return false;
        return layer.settings.every((s) => {
          if (!controls.has(s.name) || !value(s.value)) return false;
          if (
            ['gain', 'cutoff', 'lpf'].includes(s.name) &&
            s.value.core.kind === 'constant' &&
            typeof s.value.core.value === 'number'
          )
            s.value.core.value = 0;
          return true;
        });
      })
    );
  }
  for (const node of copy.body) {
    if (node.kind === 'tempo') {
      if (typeof node.cpm !== 'number' || !Number.isFinite(node.cpm) || node.cpm <= 0) return;
      continue;
    }
    if (node.kind !== 'shared' && node.kind !== 'voice') return;
    if (!pattern(node.pattern)) return;
    if (node.kind === 'shared') {
      // Shadowing a built-in can change the meaning of subsequent generators.
      if (
        !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(node.name) ||
        names.has(node.name) ||
        controls.has(node.name) ||
        groups.has(node.name) ||
        ['silence', 'mini', 'pure', 'setcpm'].includes(node.name)
      )
        return;
      names.add(node.name);
    }
  }
  return JSON.stringify(copy);
}
