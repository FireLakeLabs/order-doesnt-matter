import type { Doc, Setting } from '../types';
import { replaceNode, type Refusal } from './shared';
import { signalShapes, signalState } from './signal-shared';
export function setSignalShape(doc: Doc, id: string, shape: string): Doc | Refusal {
  const state = signalState(doc, id);
  if ('ok' in state) return state;
  if (!signalShapes.some((s) => s === shape))
    return { ok: false, reason: 'Choose a supported shape' };
  if (state.shape === shape) return doc;
  const replacement: Setting = {
    ...state.setting,
    value: { ...state.pattern, core: { kind: 'signal', shape } },
  };
  return replaceNode(doc, id, replacement);
}
