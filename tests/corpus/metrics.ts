import type { Arg, Doc, Pattern } from '../../src/document';

/** Semantic boundaries: cores, settings, rewrites, opaque source, arguments,
 * tempo and transforms. Voice/shared wrappers and settings bags are containers.
 * This follows the spike's coverage unit without relying on its old Doc shape.
 */
export function tierTotals(doc: Doc): Record<1 | 2 | 3, number> {
  const totals = { 1: 0, 2: 0, 3: 0 };
  function args(items: Arg[]) {
    for (const arg of items) {
      if (arg.kind === 'literal') totals[1]++;
      else if (arg.kind === 'opaque') totals[3]++;
      else pattern(arg.kind === 'pattern' ? arg.pattern : arg.body);
    }
  }
  function pattern(p: Pattern) {
    totals[p.tier]++;
    if (p.core.kind === 'group') for (const part of p.core.parts) pattern(part.pattern);
    if (p.core.kind === 'generator') args(p.core.args);
    if (p.core.kind === 'signal' && p.core.args) args(p.core.args);
    for (const layer of p.layers) {
      if (layer.kind === 'settings')
        for (const setting of layer.settings) {
          totals[setting.tier]++;
          pattern(setting.value);
        }
      else {
        totals[layer.tier]++;
        if (layer.kind === 'rewrite') args(layer.args);
      }
    }
  }
  for (const node of doc.body) {
    if (node.kind === 'shared' || node.kind === 'voice') pattern(node.pattern);
    else {
      totals[node.tier]++;
      if (node.kind === 'transform') args(node.args);
    }
  }
  return totals;
}
