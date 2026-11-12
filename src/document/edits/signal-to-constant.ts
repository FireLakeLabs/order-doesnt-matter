import type { Doc, Setting } from '../types';
import { replaceNode, type Refusal } from './shared';
import { signalState } from './signal-shared';
export function signalToConstant(doc: Doc, id: string): Doc | Refusal {
  const state = signalState(doc, id);
  if ('ok' in state) return state;
  if (state.low === null || state.high === null || state.period === null || state.others.length)
    return {
      ok: false,
      reason: 'Other signal layers need source text before making this one value',
    };
  const value = state.low / 2 + state.high / 2;
  const replacement: Setting = {
    ...state.setting,
    value: { ...state.pattern, core: { kind: 'constant', value }, layers: [] },
  };
  return replaceNode(doc, id, replacement);
}
