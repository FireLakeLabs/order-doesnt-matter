import type { Doc } from '../types';
import type { Refusal } from './shared';
import { signalLayer, signalState } from './signal-shared';
export function setSignalPeriod(doc: Doc, id: string, period: number): Doc | Refusal {
  const state = signalState(doc, id);
  if ('ok' in state) return state;
  if (state.period === null)
    return {
      ok: false,
      reason: 'This speed has several layers or changing values; edit its source text',
    };
  if (!Number.isFinite(period) || period <= 0 || !Number.isFinite(1 / period))
    return { ok: false, reason: 'Use a positive, finite period in cycles' };
  return signalLayer(doc, state.setting, state.speed, state.speed?.name ?? 'slow', [
    state.speed?.name === 'fast' ? 1 / period : period,
  ]);
}
