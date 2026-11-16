import { definitionMuted, setMuted } from '../document/edits/set-muted';
import type { Doc } from '../document';
import { instruments } from '../document';
import { views } from '../views';
import { resolveTheme } from './themes';

export type Stage = 'a' | 'b';
export interface Layout {
  a: string | null;
  b: string | null;
  lookAhead: 1 | 2 | 4 | 8;
  trails: 0 | 1 | 2;
  theme: string;
}
let restoredSelection = false;
export function consumeRestoredSelection() {
  const value = restoredSelection;
  restoredSelection = false;
  return value;
}
export const layoutKey = 'odm-studio-layout';
const defaults: Layout = { a: 'ring', b: 'loom', lookAhead: 4, trails: 1, theme: 'arcade' };
/** Treat storage and links as untrusted input; an explicit empty stage clears it. */
export function parseLayout(stored: string | null, search: string, ids: readonly string[]): Layout {
  let value: Partial<Layout> = {};
  try {
    const parsed: unknown = JSON.parse(stored ?? '{}');
    if (parsed && typeof parsed === 'object') value = parsed;
  } catch {
    /* Storage is optional. */
  }
  const validView = (id: unknown) => (typeof id === 'string' && ids.includes(id) ? id : null);
  const params = new URLSearchParams(search);
  return {
    a: params.has('a')
      ? validView(params.get('a'))
      : value.a === undefined
        ? validView(defaults.a)
        : validView(value.a),
    b: params.has('b')
      ? validView(params.get('b'))
      : value.b === undefined
        ? validView(defaults.b)
        : validView(value.b),
    lookAhead:
      value.lookAhead === 1 ||
      value.lookAhead === 2 ||
      value.lookAhead === 4 ||
      value.lookAhead === 8
        ? value.lookAhead
        : defaults.lookAhead,
    trails:
      value.trails === 0 || value.trails === 1 || value.trails === 2
        ? value.trails
        : defaults.trails,
    theme: resolveTheme(
      params.has('theme')
        ? params.get('theme')
        : typeof value.theme === 'string'
          ? value.theme
          : null,
    ).name,
  };
}
interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function createSession(layout: Layout, storage?: StoragePort) {
  let snapshot = {
    layout,
    selectedInstrument: null as string | null,
    editorTarget: null as string | null,
    expandedSettings: [] as string[],
    filledStage: null as Stage | null,
  };
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const notify of listeners) notify();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    restore(value: typeof snapshot) {
      snapshot = value;
      restoredSelection = true;
      try {
        storage?.setItem(layoutKey, JSON.stringify(snapshot.layout));
      } catch {
        /* Storage is optional. */
      }
      emit();
    },
    layout(change: Partial<Layout>) {
      snapshot = { ...snapshot, layout: { ...snapshot.layout, ...change } };
      try {
        storage?.setItem(layoutKey, JSON.stringify(snapshot.layout));
      } catch {
        /* Storage is optional. */
      }
      emit();
    },
    selectInstrument(id: string | null) {
      snapshot = { ...snapshot, selectedInstrument: id, editorTarget: null };
      emit();
    },
    resetSelection() {
      snapshot = {
        ...snapshot,
        selectedInstrument: null,
        editorTarget: null,
        expandedSettings: [],
      };
      emit();
    },
    openEditor(id: string | null) {
      snapshot = { ...snapshot, editorTarget: id };
      emit();
    },
    toggleLane(id: string) {
      const expanded = snapshot.expandedSettings;
      snapshot = {
        ...snapshot,
        expandedSettings: expanded.includes(id)
          ? expanded.filter((key) => key !== id)
          : [...expanded, id],
      };
      emit();
    },
    fill(stage: Stage | null) {
      snapshot = { ...snapshot, filledStage: stage };
      emit();
    },
  };
}
export function browserSession(ids: readonly string[]) {
  let storage: StoragePort | undefined,
    stored: string | null = null;
  try {
    storage = window.localStorage;
    stored = storage.getItem(layoutKey);
  } catch {
    /* Storage is optional. */
  }
  return createSession(parseLayout(stored, window.location.search, ids), storage);
}

// The document remains the source of mute state. Metadata follows exact history
// identities, so Undo/Redo also restores the solo button and its original mutes.
const solos = new WeakMap<Doc, { id: string; mutes: Map<string, boolean> }>();
export const soloedInstrument = (doc: Doc | null) => (doc ? (solos.get(doc)?.id ?? null) : null);
export function soloEdit(doc: Doc, id: string): Doc {
  const previous = solos.get(doc);
  const rows = instruments(doc);
  if (!rows.some((row) => row.id === id)) return doc;
  const mutes =
    previous?.mutes ?? new Map(rows.map((row) => [row.id, definitionMuted(doc, row.id)]));
  let next = doc;
  for (const row of rows) {
    const edited = setMuted(
      next,
      row.id,
      previous?.id === id ? (mutes.get(row.id) ?? false) : row.id !== id,
    );
    if ('ok' in edited) return doc;
    next = edited;
  }
  if (previous?.id !== id && next !== doc) solos.set(next, { id, mutes });
  return next;
}
/** A direct mute ends solo and restores its original mutes before the requested change. */
export function muteEdit(doc: Doc, id: string): Doc {
  const muted = definitionMuted(doc, id);
  const solo = soloedInstrument(doc);
  const restored = solo ? soloEdit(doc, solo) : doc;
  const next = setMuted(restored, id, !muted);
  return 'ok' in next ? doc : next;
}
export const session =
  typeof window === 'undefined'
    ? createSession(defaults)
    : browserSession(views.map((view) => view.id));
