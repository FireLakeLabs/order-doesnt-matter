import type { Doc } from '../document';
export interface PendingEntry {
  token: number;
  revision?: number;
  status: 'pending' | 'failed';
  reason?: string;
  instruments?: string[];
  names?: string[];
}
export interface Pending {
  doc: Doc;
  good: Doc;
  entries: Record<string, PendingEntry>;
  heard: number;
  goodRevision: number;
  snapshots: Record<number, Doc>;
  scheduled: Record<number, { cycle?: number; instruments: string[] }>;
  cycle: number;
}
export const pending = (doc: Doc): Pending => ({
  doc,
  good: doc,
  entries: {},
  heard: 0,
  goodRevision: 0,
  snapshots: {},
  scheduled: {},
  cycle: -Infinity,
});
export type PendingEvent =
  | {
      type: 'edit';
      doc: Doc;
      target: string;
      token: number;
      playing: boolean;
      instruments?: string[];
      names?: string[];
    }
  | { type: 'sent'; doc: Doc; token: number; revision: number }
  | { type: 'swapped' | 'committed'; revision: number; cycle?: number }
  | { type: 'trigger'; revision: number; instrument?: string; cycle: number }
  | { type: 'progress'; cycle: number }
  | { type: 'failed'; token: number; reason: string }
  | { type: 'clear' }
  | { type: 'load'; doc: Doc };
/** Revisions are bound after play resolves; either acknowledgement may arrive first. A new edit
 * has no revision yet, so an older swap cannot accidentally clear its marker. */
export function transition(p: Pending, event: PendingEvent): Pending {
  if (event.type === 'load') return pending(event.doc);
  if (event.type === 'clear') return { ...pending(p.doc), heard: p.heard };
  if (event.type === 'edit')
    return event.playing
      ? {
          ...p,
          doc: event.doc,
          entries: {
            ...p.entries,
            [event.target]: {
              token: event.token,
              status: 'pending',
              instruments: event.instruments,
              names: event.names,
            },
          },
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
  let { heard, snapshots, cycle } = p;
  const scheduled = { ...p.scheduled };
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
  } else if (event.type === 'progress') cycle = event.cycle;
  else {
    heard = Math.max(heard, event.revision);
    const old = scheduled[event.revision];
    scheduled[event.revision] = {
      cycle: old?.cycle ?? event.cycle,
      instruments: [
        ...new Set([
          ...(old?.instruments ?? []),
          ...(event.type === 'trigger' && event.instrument ? [event.instrument] : []),
        ]),
      ],
    };
  }
  const latest = Object.keys(snapshots)
    .map(Number)
    .filter((r) => r <= heard && r >= p.goodRevision)
    .sort((a, b) => b - a)[0];
  const good = latest === undefined ? p.good : snapshots[latest];
  snapshots = Object.fromEntries(Object.entries(snapshots).filter(([r]) => Number(r) > heard));
  entries = Object.fromEntries(
    Object.entries(entries).filter(([, e]) => {
      if (e.status === 'failed' || e.revision === undefined || e.revision > heard) return true;
      // Targets without instruments (including explicitly muted/deleted rows)
      // retain the acknowledgement path. Sparse rows wait for their own start.
      if (!e.instruments?.length) return false;
      const answers = Object.entries(scheduled).filter(([r]) => Number(r) >= e.revision!);
      const started = new Set(answers.flatMap(([, a]) => a.instruments));
      const first = Math.min(...answers.map(([, a]) => a.cycle ?? Infinity));
      return !e.instruments.every((id) => started.has(id)) && cycle < first + 1;
    }),
  );
  // Only the active and preceding revision can still deliver scheduler callbacks.
  const retained = Object.fromEntries(
    Object.entries(scheduled).filter(
      ([r]) =>
        Number(r) >= heard - 1 || Object.values(entries).some((e) => e.revision === Number(r)),
    ),
  );
  return {
    ...p,
    heard,
    good,
    goodRevision: latest ?? p.goodRevision,
    snapshots,
    entries,
    scheduled: retained,
    cycle,
  };
}

export function pendingWords(entry: PendingEntry) {
  return entry.names?.length
    ? `Changing… you will hear it on ${entry.names.join(' and ')}'s next note`
    : 'Changing… waiting for the change to be scheduled';
}
