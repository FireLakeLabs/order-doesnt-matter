import type { CycleLoop, PlaybackSpeed } from '../contract';
export { actualCps, speeds, wrapCycle } from '../engine/transport';

export function pointerCycle(x: number, left: number, width: number, from: number, to: number) {
  return from + Math.max(0, Math.min(1, width > 0 ? (x - left) / width : 0)) * (to - from);
}
export function markedLoop(a: number, b: number): CycleLoop {
  return {
    from: Math.round(Math.min(a, b)),
    to: Math.max(Math.round(Math.min(a, b)) + 1, Math.round(Math.max(a, b))),
  };
}
export function pageRange(now: number) {
  const from = Math.max(0, Math.floor(now / 4) * 4 - 4);
  return { from, to: from + 16 };
}
export interface TransportSnapshot {
  speed: PlaybackSpeed;
  loop: CycleLoop | null;
  scrubbing: boolean;
  marking: boolean;
}
/** Only discrete transport choices notify React. Pointer time stays in runtime. */
export function createTransportStore() {
  let snapshot: TransportSnapshot = { speed: 1, loop: null, scrubbing: false, marking: false };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(change: Partial<TransportSnapshot>) {
      snapshot = { ...snapshot, ...change };
      for (const listener of listeners) listener();
    },
  };
}
