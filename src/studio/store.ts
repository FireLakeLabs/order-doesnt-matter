import { useSyncExternalStore } from 'react';
import type { AppState } from '../app/state';

interface Source {
  readonly state: AppState;
  readonly canPlay: boolean;
  subscribe(listener: () => void): () => void;
}
export interface StudioSnapshot {
  state: AppState;
  canPlay: boolean;
}
/** Cache by value identity, including readiness which lives outside AppState. */
export function createStore(source: Source) {
  let snapshot: StudioSnapshot = { state: source.state, canPlay: source.canPlay };
  const getSnapshot = () => {
    if (snapshot.state !== source.state || snapshot.canPlay !== source.canPlay)
      snapshot = { state: source.state, canPlay: source.canPlay };
    return snapshot;
  };
  const subscribe = (notify: () => void) => source.subscribe(notify);
  return { getSnapshot, subscribe };
}
export function useStudioStore(store: ReturnType<typeof createStore>) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
