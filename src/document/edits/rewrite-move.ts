import type { Doc, RewriteLayer, SettingsLayer } from '../types';
import { replaceAtPath, type Refusal } from './shared';
import { rewriteOwner } from './rewrite-shared';

// Measured against pinned Strudel in tests/rewrite-constants.test.ts. Even a
// constant control can split event fragments at cycle boundaries: fast/slow and
// early/late do not commute. This list deliberately excludes unmeasured controls.
const provenSettings = new Set(['cutoff', 'gain', 'pan', 'room', 's', 'n']);
const provenRewrites: Record<string, number> = {
  rev: 0,
  palindrome: 0,
  ply: 1,
  degradeBy: 1,
  euclid: 2,
  segment: 1,
};
function canCross(rewrite: RewriteLayer, layer: SettingsLayer): boolean {
  const arity = Object.hasOwn(provenRewrites, rewrite.name)
    ? provenRewrites[rewrite.name]
    : undefined;
  return (
    arity !== undefined &&
    rewrite.args.length === arity &&
    rewrite.args.every(
      (arg) =>
        arg.kind === 'literal' && typeof arg.value === 'number' && Number.isFinite(arg.value),
    ) &&
    layer.settings.length > 0 &&
    layer.settings.every(
      ({ name, value }) =>
        provenSettings.has(name) &&
        value.core.kind === 'constant' &&
        !value.layers.length &&
        !value.muted,
    )
  );
}
/** Move one adjacent layer, crossing only measured constant-setting pairs. */
export function moveRewrite(doc: Doc, id: string, direction: -1 | 1): Doc | Refusal {
  const owner = rewriteOwner(doc, id);
  if (!owner) return { ok: false, reason: 'This rewrite no longer exists' };
  const layers = owner.pattern.layers,
    other = owner.index + direction,
    neighbour = layers[other];
  if (
    ![-1, 1].includes(direction) ||
    !neighbour ||
    (neighbour.kind !== 'rewrite' &&
      !(neighbour.kind === 'settings' && canCross(owner.layer, neighbour)))
  )
    return {
      ok: false,
      reason: 'This move could change the rhythm, or cross source text or a pattern boundary',
    };
  const next = [...layers];
  [next[owner.index], next[other]] = [next[other], next[owner.index]];
  return replaceAtPath(doc, [...owner.path, 'layers'], next);
}
