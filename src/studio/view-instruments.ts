import { walk, type Doc } from '../document';
import { describeTarget } from '../document/edit';
import { sheetModel } from '../sheet/model';
import type { ViewInstrument, ViewSetting } from '../views/types';

type Facts = Pick<ViewInstrument, 'settings' | 'rewrites' | 'room'>;
const cache = new WeakMap<Doc, Map<string, Facts>>();
// Match the setting names used by the values editor.
const labels: Record<string, string> = { lpf: 'cutoff', hpf: 'hcutoff', roomsize: 'size' };

/** Sheet inventory owns settings-in-use and rewrite order. Never query on a frame. */
export function instrumentFacts(doc: Doc | null): Map<string, Facts> {
  if (!doc) return new Map();
  const cached = cache.get(doc);
  if (cached) return cached;
  const order = new Map<string, number>();
  walk(doc, (node) => order.set(node.id, order.size));
  const sheet = sheetModel({
    doc,
    fromCycle: 0,
    toCycle: 1,
    events: {},
    sounds: [],
    playhead: null,
  });
  const facts = new Map<string, Facts>();
  for (const row of sheet.rows) {
    const entries = [
      ...row.cells
        .filter((cell) => cell.name !== 'rhythm' && cell.kind !== 'unused')
        .map((cell) => ({ nodeId: cell.nodeId, name: cell.name })),
      ...row.useTargets
        .map((target) => ({
          nodeId: target.nodeId,
          name: describeTarget(doc, target.nodeId).control,
        }))
        .filter((target) => target.name),
    ].sort((a, b) => (order.get(a.nodeId) ?? -1) - (order.get(b.nodeId) ?? -1));
    const settings = new Map<string, ViewSetting>();
    for (const entry of entries) {
      const target = describeTarget(doc, entry.nodeId);
      let kind: ViewSetting['kind'] =
        target.kind === 'setting-constant'
          ? 'constant'
          : target.kind === 'setting-values'
            ? 'values'
            : target.kind === 'setting-signal'
              ? 'signal'
              : 'other';
      const previous = settings.get(entry.name);
      if (previous) {
        if (previous.kind === 'signal' || kind === 'signal') kind = 'signal';
        else if (
          previous.kind === 'values' ||
          (kind === 'constant' && previous.value !== target.value)
        )
          kind = 'values';
      }
      settings.set(entry.name, {
        name: entry.name,
        label: labels[entry.name] ?? entry.name,
        // Section variations must not advertise a definition's constant as universal.
        kind,
        ...(kind === 'constant' &&
        (typeof target.value === 'number' || typeof target.value === 'string')
          ? { value: target.value }
          : {}),
      });
    }
    const rewrites = row.rewrites.map((chip) => `${chip.name} ${chip.summary}`.trim());
    const rewriteIds = new Set(row.rewrites.map((chip) => chip.nodeId));
    for (const use of row.useTargets) {
      const target = describeTarget(doc, use.nodeId);
      if (target.node && 'kind' in target.node && target.node.kind === 'rewrite') {
        const label = use.text.replace(/^in .*?: /, '');
        if (!rewriteIds.has(use.nodeId)) {
          rewrites.push(label);
          rewriteIds.add(use.nodeId);
        }
      }
    }
    const orbit = settings.get('orbit');
    const room =
      orbit?.kind === 'constant' && typeof orbit.value === 'number'
        ? orbit.value
        : orbit
          ? null
          : 1;
    facts.set(row.id, { settings: [...settings.values()], rewrites, room });
  }
  cache.set(doc, facts);
  return facts;
}
