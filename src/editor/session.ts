import { instruments, walk, type Doc, type Setting } from '../document';
import { describeTarget } from '../document/edit';
import { setConstant } from '../document/edits/set-constant';
import { generate } from '../generate';
import type { Constant } from '../document/edit';
import { history, push, undo, redo, type History } from './history';
import { pending, transition, type Pending, type PendingEvent } from './pending';
import { createBrowserQueries } from '../strudel/evaluate-browser';
export const SWAP_THROTTLE_MS = 100;
/** Generation is the dependency graph: setup, references and use-site edits all count. */
export function changedInstruments(before: Doc, next: Doc): string[] {
  const old = new Map(instruments(before).map((r) => [r.id, generate(before, { only: r.id })]));
  return instruments(next)
    .filter((r) => old.get(r.id) !== generate(next, { only: r.id }))
    .map((r) => r.id);
}
interface Ports {
  playing(): boolean;
  play(doc: Doc): Promise<number>;
  changed(state: Pending): void;
  refresh(doc: Doc, targets: string[]): void;
}
function values(doc: Doc) {
  const result = new Map<string, Setting>();
  walk(doc, (n) => {
    if ('name' in n && 'value' in n) result.set(n.id, n as Setting);
  });
  return result;
}
/** Coordinates immutable documents with an injected engine. One running swap and
 * one latest candidate bound the queue; the trailing candidate always gets sent. */
export function createEditSession(doc: Doc, ports: Ports) {
  const questions = createBrowserQueries();
  // Opt-in inspection never exposes the mutable objects owned by the editor.
  // Weak keys retain document identities across Undo/Redo without extending retention.
  const copies = new WeakMap<Doc, Doc>();
  const exposed = new WeakMap<
    History,
    Readonly<Pick<History, 'present' | 'depth'>> & {
      readonly past: readonly Doc[];
      readonly future: readonly Doc[];
    }
  >();
  function frozenCopy(doc: Doc): Doc {
    const cached = copies.get(doc);
    if (cached) return cached;
    function freeze(value: unknown) {
      if (!value || typeof value !== 'object') return;
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    const copy = structuredClone(doc);
    freeze(copy);
    copies.set(doc, copy);
    return copy;
  }
  let h = history(doc),
    p = pending(doc),
    token = 0,
    epoch = 0,
    running = false,
    last = -Infinity;
  let queued: { doc: Doc; token: number; targets: string[] } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let operation = { serial: 0, kind: 'load' };
  const submissions = new Set<Promise<unknown>>();
  const waiters = new Set<() => void>();
  let failure = false,
    suspended = false;
  let stopGeneration = 0;
  const wake = () => {
    for (const done of waiters) done();
  };
  const emit = () => ports.changed(p);
  function cancel() {
    epoch++;
    clearTimeout(timer);
    timer = undefined;
    queued = undefined;
    wake();
  }
  function schedule() {
    if (running || timer || !queued) return;
    const delay = Math.max(0, SWAP_THROTTLE_MS - (performance.now() - last));
    if (delay)
      timer = setTimeout(() => {
        timer = undefined;
        void flush();
      }, delay);
    else void flush();
  }
  async function flush() {
    if (running || !queued) return;
    const work = queued,
      generation = epoch,
      stopped = stopGeneration;
    queued = undefined;
    running = true;
    last = performance.now();
    ports.refresh(work.doc, work.targets);
    try {
      const revision = ports.playing() ? await ports.play(work.doc) : -1;
      if (generation !== epoch) return;
      p =
        revision < 0
          ? transition(p, { type: 'clear' })
          : transition(p, { type: 'sent', ...work, revision });
      emit();
    } catch (error) {
      if (generation !== epoch) return;
      // Explicit Stop already retained this document as a stopped edit. Its
      // cancelled audio replacement is not a failed submission in that session.
      if (stopped !== stopGeneration) return;
      failure = true;
      const before = p.doc;
      p = transition(p, {
        type: 'failed',
        token: work.token,
        reason: String(error instanceof Error ? error.message : error),
      });
      // A superseded failure leaves its newer candidate intact.
      if (before !== p.doc) {
        cancel();
        const confirmed = h.past.indexOf(p.doc);
        h = {
          ...h,
          present: p.doc,
          past: confirmed < 0 ? h.past : h.past.slice(0, confirmed),
          future: [],
          group: undefined,
        };
      }
      emit();
      if (before !== p.doc) {
        ports.refresh(p.doc, changedInstruments(before, p.doc));
        // A previous successful commit may still be ahead of the audio clock.
        // Reinstall the confirmed document so restored cells and playback agree.
        const recoveryEpoch = epoch,
          restored = p.doc;
        if (ports.playing())
          try {
            await ports.play(restored);
          } catch (recoveryError) {
            if (epoch === recoveryEpoch) {
              p = {
                ...p,
                entries: Object.fromEntries(
                  Object.entries(p.entries).map(([id, e]) => [
                    id,
                    { ...e, reason: `${e.reason}. Restore failed: ${String(recoveryError)}` },
                  ]),
                ),
              };
              emit();
            }
          }
      }
    } finally {
      running = false;
      schedule();
      wake();
    }
  }
  function install(next: Doc, selected?: string) {
    if (next === p.doc) return;
    const rows = changedInstruments(p.doc, next);
    const before = values(p.doc),
      targets = [...values(next)]
        .filter(([id, s]) => JSON.stringify(s.value) !== JSON.stringify(before.get(id)?.value))
        .map(([id]) => id);
    if (selected && !targets.includes(selected)) targets.push(selected);
    if (!targets.length) targets.push(...rows, 'document');
    const playing = ports.playing();
    ++token;
    const inventory = instruments(next);
    for (const target of targets) {
      const own = describeTarget(next, target).instrumentId;
      const waiting = inventory.filter(
        (row) => rows.includes(row.id) && (!own || row.id === own) && !row.muted,
      );
      p = transition(p, {
        type: 'edit',
        doc: next,
        target,
        token,
        playing,
        instruments: waiting.map((r) => r.id),
        names: waiting.map((r) => r.name),
      });
    }
    emit();
    if (playing) {
      queued = {
        doc: next,
        token,
        targets: [...new Set([...(queued?.targets ?? []), ...rows])],
      };
      schedule();
    } else ports.refresh(next, rows);
  }
  return {
    suspend(value: boolean) {
      suspended = value;
      if (value) p = transition(p, { type: 'clear' });
    },
    /** Includes source validation and rollback, but never waits for a sparse note. */
    async settle(): Promise<boolean> {
      while (submissions.size || running || queued || timer) {
        if (submissions.size) await Promise.allSettled([...submissions]);
        else
          await new Promise<void>((resolve) => {
            const done = () => {
              waiters.delete(done);
              resolve();
            };
            waiters.add(done);
          });
      }
      return !failure && !Object.values(p.entries).some((e) => e.status === 'failed');
    },
    submit(work: () => Promise<boolean>) {
      if (suspended) return Promise.resolve(false);
      const task = work().then(
        (ok) => {
          failure = !ok;
          return ok;
        },
        (error) => {
          failure = true;
          throw error;
        },
      );
      submissions.add(task);
      void task
        .finally(() => {
          submissions.delete(task);
          wake();
        })
        .catch(() => {});
      return task;
    },
    ask(candidate: Doc, instrumentId: string, from: number, to: number) {
      questions.cancel();
      return questions.query(generate(candidate, { only: instrumentId }), from, to);
    },
    get operation() {
      return operation;
    },
    get state() {
      return p;
    },
    /** Session-only, detached and deeply frozen; reading never changes undo retention. */
    get history() {
      let value = exposed.get(h);
      if (!value) {
        value = Object.freeze({
          present: frozenCopy(h.present),
          past: Object.freeze(h.past.map(frozenCopy)),
          future: Object.freeze(h.future.map(frozenCopy)),
          depth: h.depth,
        });
        exposed.set(h, value);
      }
      return value;
    },
    get canUndo() {
      return !!h.past.length;
    },
    get canRedo() {
      return !!h.future.length;
    },
    apply(next: Doc, options: { gesture?: string } = {}, target?: string) {
      if (suspended || next === p.doc) return;
      failure = false;
      operation = { serial: operation.serial + 1, kind: 'edit' };
      h = push(h, next, 'document', options.gesture);
      install(next, target);
    },
    edit(id: string, value: Constant, gesture?: string) {
      if (suspended) return;
      failure = false;
      const next = setConstant(p.doc, id, value);
      if ('ok' in next || next === p.doc) return;
      h = push(h, next, id, gesture);
      install(next, id);
    },
    undo() {
      if (suspended) return;
      failure = false;
      operation = { serial: operation.serial + 1, kind: 'undo' };
      h = undo(h);
      install(h.present);
    },
    redo() {
      if (suspended) return;
      failure = false;
      operation = { serial: operation.serial + 1, kind: 'redo' };
      h = redo(h);
      install(h.present);
    },
    observe(
      event: Extract<PendingEvent, { type: 'swapped' | 'committed' | 'trigger' | 'progress' }>,
    ) {
      if (!Object.values(p.entries).some((e) => e.status === 'pending')) return;
      const next = transition(p, event);
      const changed = Object.keys(next.entries).length !== Object.keys(p.entries).length;
      p = next;
      if ((event.type !== 'progress' && event.type !== 'trigger') || changed) emit();
    },
    stopped() {
      ++stopGeneration;
      // Stop clears display feedback, not submitted documents. A queued candidate
      // still drains (as a stopped edit); running cancellation settles in finally.
      p = transition(p, { type: 'clear' });
      emit();
      schedule();
      wake();
    },
    clear() {
      cancel();
      p = transition(p, { type: 'clear' });
      emit();
      wake();
    },
    dispose() {
      cancel();
      questions.cancel();
    },
  };
}
export type EditSession = ReturnType<typeof createEditSession>;
