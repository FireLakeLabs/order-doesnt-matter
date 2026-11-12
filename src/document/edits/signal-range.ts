import type { Doc } from '../types';
import type { Refusal } from './shared';
import { signalLayer, signalState } from './signal-shared';
export function setSignalRange(doc: Doc, id: string, low: number, high: number): Doc | Refusal {
  const state = signalState(doc, id);
  if ('ok' in state) return state;
  if (state.low === null || state.high === null)
    return {
      ok: false,
      reason: 'This range has several layers or changing bounds; edit its source text',
    };
  if (
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    low > high ||
    (state.range?.name === 'rangex' && (low <= 0 || high <= 0))
  )
    return {
      ok: false,
      reason: 'Use finite bounds, low before high, and positive values for an exponential range',
    };
  return signalLayer(doc, state.setting, state.range, state.range?.name ?? 'range', [low, high]);
}
