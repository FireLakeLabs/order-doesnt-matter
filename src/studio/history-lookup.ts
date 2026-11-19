import { instruments, walk, type Doc, type Path } from '../document';
import type { History } from '../editor/history';
import type { QueryEvents } from '../contract';
import { generate } from '../generate';
import { instrumentInventory } from './instrument-names';
import type { ViewHistoryLookup, ViewHistorySnapshot, ViewHistoryVersion } from '../views/types';

type StoredHistory = Readonly<Pick<History, 'present'>> & {
  readonly past: readonly Doc[];
  readonly future: readonly Doc[];
};
interface Questions {
  query: QueryEvents;
  cancel(): void;
}
// Document identity is the existing undo history's version identity. Weak keys
// keep ids stable across mounted views without retaining discarded documents.
let ordinal = 0;
const identities = new WeakMap<Doc, { id: string; ordinal: number }>();
function identity(doc: Doc) {
  let value = identities.get(doc);
  if (!value) {
    const next = ++ordinal;
    value = { id: `history-${String(next)}`, ordinal: next };
    identities.set(doc, value);
  }
  return value;
}
const unavailable = (reason: string): ViewHistorySnapshot => ({ status: 'unavailable', reason });
const MAX_RESULTS = 64;
const MAX_PENDING = 32;

/** Owned by one opted-in drawing. No workers, generation or cloning until a
 * score is requested. Uses an independent single-worker seam, never playback's
 * or the current score's queue. The unit of work/cache is a version + range. */
export function createHistoryLookup(questions: Questions) {
  let history: StoredHistory | null = null;
  let disposed = false;
  let documents = new Map<string, Doc>();
  let versions: readonly ViewHistoryVersion[] = [];
  interface Job {
    key: string;
    id: string;
    from: number;
    to: number;
    promise: Promise<ViewHistorySnapshot>;
    resolve(value: ViewHistorySnapshot): void;
  }
  const completed = new Map<string, { id: string; promise: Promise<ViewHistorySnapshot> }>();
  const pending = new Map<string, Job>();
  const queue: Job[] = [];
  let active: Job | undefined;
  function expire(job: Job) {
    pending.delete(job.key);
    job.resolve(unavailable('This history version is no longer stored'));
  }
  function pump() {
    if (active || disposed) return;
    const job = queue.shift();
    if (!job) return;
    active = job;
    // Generation and dispatch happen after the synchronous view frame returns.
    void Promise.resolve()
      .then(async (): Promise<ViewHistorySnapshot> => {
        const doc = documents.get(job.id);
        if (!doc || active !== job) return unavailable('This history version is no longer stored');
        const visual = structuredClone(doc);
        walk(visual, (node) => {
          if ('muted' in node) node.muted = false;
        });
        const paths = new Map<string, Path>();
        walk(doc, (node, path) => paths.set(node.id, path));
        const parts = instruments(doc);
        const { names } = instrumentInventory({ doc, rows: parts });
        const rows = [];
        for (const [index, row] of parts.entries()) {
          if (active !== job) return unavailable('This history version is no longer stored');
          const result = await questions.query(
            generate(visual, { only: row.id }),
            job.from,
            job.to,
          );
          rows.push({
            id: row.id,
            name: names[index],
            patternId: row.pattern.id,
            path: paths.get(row.pattern.id) ?? [],
            uses: row.uses.map((use) => ({
              voiceId: use.voiceId,
              pathIds: use.path.map((node) => node.id),
            })),
            result,
          });
        }
        return { status: 'available', score: { from: job.from, to: job.to, instruments: rows } };
      })
      .catch((error: unknown) =>
        unavailable(error instanceof Error ? error.message : String(error)),
      )
      .then((answer) => {
        if (active !== job) return;
        active = undefined;
        pending.delete(job.key);
        // Keep failures visible to this caller, but a later call can retry.
        if (
          answer.status === 'available' &&
          !answer.score.instruments.some((row) => row.result.error)
        ) {
          completed.set(job.key, { id: job.id, promise: job.promise });
          const oldest = completed.keys().next().value;
          if (completed.size > MAX_RESULTS && oldest) completed.delete(oldest);
        }
        job.resolve(answer);
        pump();
      });
  }
  function sync(next: StoredHistory | null) {
    if (next === history) return;
    history = next;
    documents = new Map();
    const describe = (doc: Doc, position: ViewHistoryVersion['position']) => {
      const key = identity(doc);
      documents.set(key.id, doc);
      return Object.freeze({ ...key, position });
    };
    versions = Object.freeze(
      next
        ? [
            ...next.past.map((doc) => describe(doc, 'past')),
            describe(next.present, 'present'),
            ...next.future.map((doc) => describe(doc, 'future')),
          ]
        : [],
    );
    for (const [key, value] of completed) if (!documents.has(value.id)) completed.delete(key);
    for (let i = queue.length - 1; i >= 0; i--)
      if (!documents.has(queue[i].id)) expire(queue.splice(i, 1)[0]);
    if (active && !documents.has(active.id)) {
      expire(active);
      active = undefined;
      questions.cancel();
      pump();
    }
  }
  function ask(id: string, from: number, to: number): Promise<ViewHistorySnapshot> {
    if (disposed || !documents.has(id))
      return Promise.resolve(unavailable('This history version is no longer stored'));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)
      return Promise.resolve(unavailable('Expected a finite, increasing frame range'));
    const key = JSON.stringify([id, from, to]);
    const cached = completed.get(key)?.promise ?? pending.get(key)?.promise;
    if (cached) return cached;
    if (pending.size >= MAX_PENDING)
      return Promise.resolve(
        unavailable('History query queue is full; retry score on a later frame'),
      );
    let resolve!: Job['resolve'];
    const promise = new Promise<ViewHistorySnapshot>((done) => {
      resolve = done;
    });
    const job = { id, key, from, to, promise, resolve };
    pending.set(key, job);
    queue.push(job);
    pump();
    return promise;
  }
  return {
    /** Reuse the host's existing edit/load notifications, including while a
     * score is pending or a drawing has no drawable size. */
    update(next: StoredHistory | null) {
      if (!disposed) sync(next);
    },
    forFrame(next: StoredHistory | null, range: { from: number; to: number }): ViewHistoryLookup {
      if (!disposed) sync(next);
      // Capture only ids/range: retained old frame handles cannot keep Docs alive.
      const { from, to } = range;
      return { versions, score: (id) => ask(id, from, to) };
    },
    dispose() {
      disposed = true;
      for (const job of pending.values())
        job.resolve(unavailable('This history view was disposed'));
      pending.clear();
      queue.length = 0;
      active = undefined;
      completed.clear();
      documents.clear();
      versions = [];
      history = null;
      questions.cancel();
    },
  };
}
