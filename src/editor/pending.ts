import type { Doc } from '../document';
export interface PendingEntry {
  token: number;
  revision?: number;
  status: 'pending' | 'failed';
  reason?: string;
}
export interface Pending {
  doc: Doc;
  good: Doc;
  entries: Record<string, PendingEntry>;
  heard: number;
  goodRevision: number;
  snapshots: Record<number, Doc>;
}
export const pending = (doc: Doc): Pending => ({
  doc,
  good: doc,
  entries: {},
  heard: 0,
  goodRevision: 0,
  snapshots: {},
});
export type PendingEvent =
  | { type: 'edit'; doc: Doc; target: string; token: number; playing: boolean }
  | { type: 'sent'; doc: Doc; token: number; revision: number }
  | { type: 'swapped'; revision: number }
  | { type: 'failed'; token: number; reason: string }
  | { type: 'clear' }
  | { type: 'load'; doc: Doc };
/** Revisions are bound after play resolves; swapped may arrive first. A new edit
 * has no revision yet, so an older swap cannot accidentally clear its marker. */
export function transition(p: Pending, event: PendingEvent): Pending {
  if (event.type === 'load') return pending(event.doc);
  if (event.type === 'clear') return { ...pending(p.doc), heard: p.heard };
  if (event.type === 'edit')
    return event.playing
      ? {
          ...p,
          doc: event.doc,
          entries: { ...p.entries, [event.target]: { token: event.token, status: 'pending' } },
        }
      : { ...pending(event.doc), heard: p.heard };
  if (event.type === 'failed') {
    if (
      !Object.values(p.entries).some(
        (e) => e.token <= event.token && e.revision === undefined && e.status === 'pending',
      )
    )
      return p;
    return {
      ...p,
      doc: p.good,
      snapshots: {},
      entries: Object.fromEntries(
        Object.entries(p.entries).map(([id, e]) => [
          id,
          { ...e, status: 'failed', reason: event.reason },
        ]),
      ),
    };
  }
  let { heard, snapshots } = p;
  let entries = { ...p.entries };
  if (event.type === 'sent') {
    snapshots = { ...snapshots, [event.revision]: event.doc };
    entries = Object.fromEntries(
      Object.entries(entries).map(([id, e]) => [
        id,
        e.token <= event.token && e.revision === undefined && e.status === 'pending'
          ? { ...e, revision: event.revision }
          : e,
      ]),
    );
  } else heard = Math.max(heard, event.revision);
  const latest = Object.keys(snapshots)
    .map(Number)
    .filter((r) => r <= heard && r >= p.goodRevision)
    .sort((a, b) => b - a)[0];
  const good = latest === undefined ? p.good : snapshots[latest];
  snapshots = Object.fromEntries(Object.entries(snapshots).filter(([r]) => Number(r) > heard));
  entries = Object.fromEntries(
    Object.entries(entries).filter(
      ([, e]) => e.status === 'failed' || e.revision === undefined || e.revision > heard,
    ),
  );
  return { ...p, heard, good, goodRevision: latest ?? p.goodRevision, snapshots, entries };
}
