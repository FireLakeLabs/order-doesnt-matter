import { findById, type Doc, type Pattern, type RewriteLayer, type Setting } from '../index';
import { freshIds, replaceNode, type Refusal } from './shared';
// These eight zero-argument signals are exported by pinned core/signal.mjs and
// recognized by the import registry. irand requires arguments; time is unbounded.
export const signalShapes = [
  'sine',
  'cosine',
  'saw',
  'isaw',
  'tri',
  'square',
  'perlin',
  'rand',
] as const;
export function signalSetting(doc: Doc, id: string): Setting | Refusal {
  const node = findById(doc, id);
  return node && 'value' in node && 'name' in node
    ? (node as Setting)
    : { ok: false, reason: 'Choose a setting that still exists' };
}
function layer(pattern: Pattern, names: string[], count: number) {
  const layers = pattern.layers.filter(
    (l): l is RewriteLayer => l.kind === 'rewrite' && names.includes(l.name),
  );
  const selected = layers[0];
  const numbers = selected?.args.map((a) =>
    a.kind === 'literal' && typeof a.value === 'number' ? a.value : NaN,
  );
  const valid =
    layers.length <= 1 &&
    (!selected || (numbers?.length === count && numbers.every(Number.isFinite)));
  return { selected, numbers, valid };
}
export function signalState(doc: Doc, id: string) {
  const setting = signalSetting(doc, id);
  if ('ok' in setting) return setting;
  const pattern = setting.value;
  if (pattern.core.kind !== 'signal' || pattern.core.args?.length)
    return {
      ok: false,
      reason: 'This signal is reused or takes arguments; edit its source text',
    } as Refusal;
  const r = layer(pattern, ['range', 'rangex'], 2),
    p = layer(pattern, ['slow', 'fast'], 1);
  const period = p.selected?.name === 'fast' ? 1 / p.numbers![0] : (p.numbers?.[0] ?? 1);
  return {
    setting,
    pattern,
    shape: pattern.core.shape,
    range: r.selected,
    speed: p.selected,
    low: r.valid ? (r.numbers?.[0] ?? 0) : null,
    high: r.valid ? (r.numbers?.[1] ?? 1) : null,
    period: p.valid && period > 0 && Number.isFinite(period) ? period : null,
    others: pattern.layers.filter((l) => l !== r.selected && l !== p.selected),
  };
}
export function signalLayer(
  doc: Doc,
  setting: Setting,
  old: RewriteLayer | undefined,
  name: string,
  values: number[],
): Doc | Refusal {
  const args = values.map((value) => ({ kind: 'literal' as const, value }));
  if (old && old.name === name && JSON.stringify(old.args) === JSON.stringify(args)) return doc;
  const next: RewriteLayer = old
    ? { ...old, args }
    : { kind: 'rewrite', name, args, id: freshIds(doc)(), tier: 1 };
  const layers = old
    ? setting.value.layers.map((l) => (l === old ? next : l))
    : [...setting.value.layers, next];
  const replacement: Setting = {
    ...setting,
    value: { ...setting.value, layers },
  };
  return replaceNode(doc, setting.id, replacement);
}
