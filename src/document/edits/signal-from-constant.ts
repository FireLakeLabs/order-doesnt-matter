import type { Doc, Setting } from '../types';
import { replaceNode, freshIds, type Refusal } from './shared';
import { signalSetting } from './signal-shared';
import { controlInfo } from '../../editor/controls';
export function constantToSignal(doc: Doc, id: string): Doc | Refusal {
  const setting = signalSetting(doc, id);
  if ('ok' in setting) return setting;
  const p = setting.value,
    c = p.core;
  if (
    c.kind !== 'constant' ||
    typeof c.value !== 'number' ||
    !Number.isFinite(c.value) ||
    p.layers.length
  )
    return { ok: false, reason: 'Choose one finite numeric value' };
  const info = controlInfo(setting.name),
    width = info ? (info.max - info.min) / 10 : Math.max(Math.abs(c.value) / 2, 0.5);
  let low = info?.scale === 'log' && c.value > 0 ? c.value / 2 : c.value - width;
  let high = info?.scale === 'log' && c.value > 0 ? c.value * 2 : c.value + width;
  if (info && c.value >= info.min && c.value <= info.max) {
    low = Math.max(info.min, low);
    high = Math.min(info.max, high);
  }
  if (![low, high].every(Number.isFinite) || low >= high)
    return { ok: false, reason: 'This value is too large for a signal range' };
  const idFor = freshIds(doc);
  const replacement: Setting = {
    ...setting,
    value: {
      ...p,
      core: { kind: 'signal', shape: 'sine' },
      layers: [
        {
          id: idFor(),
          tier: 1,
          kind: 'rewrite',
          name: 'range',
          args: [
            { kind: 'literal', value: low },
            { kind: 'literal', value: high },
          ],
        },
        {
          id: idFor(),
          tier: 1,
          kind: 'rewrite',
          name: 'slow',
          args: [{ kind: 'literal', value: 4 }],
        },
      ],
    },
  };
  return replaceNode(doc, id, replacement);
}
