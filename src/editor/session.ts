import { instruments, walk, type Doc, type Setting } from '../document';
import { setConstant } from '../document/edits/set-constant';
import { generate } from '../generate';
import type { Constant } from '../document/edit';
import { history, push, undo, redo } from './history';
import { pending, transition, type Pending, type PendingEvent } from './pending';
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
  let h = history(doc),
    p = pending(doc),
    token = 0,
    epoch = 0,
    running = false,
    last = -Infinity;
  let queued: { doc: Doc; token: number; targets: string[] } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const emit = () => ports.changed(p);
  function cancel() {
    epoch++;
    clearTimeout(timer);
    timer = undefined;
    queued = undefined;
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
      generation = epoch;
    queued = undefined;
    running = true;
    last = performance.now();
    ports.refresh(work.doc, work.targets);
    try {
      const revision = await ports.play(work.doc);
      if (generation !== epoch) return;
      p = transition(p, { type: 'sent', ...work, revision });
      emit();
    } catch (error) {
      if (generation !== epoch) return;
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
    for (const target of targets)
      p = transition(p, { type: 'edit', doc: next, target, token, playing });
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
    get state() {
      return p;
    },
    get canUndo() {
      return !!h.past.length;
    },
    get canRedo() {
      return !!h.future.length;
    },
    apply(next: Doc, options: { gesture?: string } = {}, target?: string) {
      if (next === p.doc) return;
      h = push(h, next, 'document', options.gesture);
      install(next, target);
    },
    edit(id: string, value: Constant, gesture?: string) {
      const next = setConstant(p.doc, id, value);
      if ('ok' in next || next === p.doc) return;
      h = push(h, next, id, gesture);
      install(next, id);
    },
    undo() {
      h = undo(h);
      install(h.present);
    },
    redo() {
      h = redo(h);
      install(h.present);
    },
    observe(event: Extract<PendingEvent, { type: 'swapped' }>) {
      p = transition(p, event);
      emit();
    },
    clear() {
      cancel();
      p = transition(p, { type: 'clear' });
      emit();
    },
    dispose: cancel,
  };
}
export type EditSession = ReturnType<typeof createEditSession>;
