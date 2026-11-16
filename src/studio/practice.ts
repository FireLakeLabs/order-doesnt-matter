import { runtime, transport } from './runtime';
import { session } from './session';
import { examples } from '../app/examples';
import { freezeEditor, parkEditor, restoreEditor } from './tray/park';

let snapshot = { open: false, preparing: false, active: false, step: 0, error: '' };
const listeners = new Set<() => void>();
const update = (change: Partial<typeof snapshot>) => {
  snapshot = { ...snapshot, ...change };
  for (const listener of listeners) listener();
};
let run: AbortController | undefined;
let original: ReturnType<typeof session.getSnapshot> | undefined;
let originalTime: ReturnType<typeof transport.getSnapshot> | undefined;
let wasScrubbing = false;
let baseline: ReturnType<typeof session.getSnapshot>['layout'];
export const practice = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => snapshot,
  open() {
    if (snapshot.active || snapshot.open) return;
    freezeEditor(true);
    update({ open: true, error: '' });
  },
  close() {
    run?.abort();
    run = undefined;
    update({ active: false });
    freezeEditor(false);
    if (runtime.app.practice) {
      runtime.stop();
      restoreEditor();
      runtime.app.endPractice(() => {
        if (original) session.restore(original);
        if (originalTime) {
          runtime.setSpeed(originalTime.speed);
          transport.update({ ...originalTime, scrubbing: false, marking: false });
        }
      });
    }
    original = undefined;
    originalTime = undefined;
    update({ open: false, preparing: false, active: false, error: '' });
  },
  async start() {
    if (snapshot.preparing || snapshot.active) return;
    run = new AbortController();
    const own = run;
    const cancelled = () => own.signal.aborted;
    update({ preparing: true, error: '' });
    try {
      const ok = await runtime.app.beginPractice(own.signal, () => {
        original = session.getSnapshot();
        originalTime = transport.getSnapshot();
        parkEditor();
      });
      if (cancelled()) return;
      if (!ok) {
        update({
          preparing: false,
          error: 'Submitted work could not settle. Close help, correct the error, and try again.',
        });
        return;
      }
      runtime.stop();
      await runtime.setLoop(null);
      if (cancelled()) return;
      runtime.setSpeed(1);
      session.resetSelection();
      session.fill(null);
      freezeEditor(false);
      await runtime.load(examples[0].source);
      if (cancelled()) return;
      baseline = session.getSnapshot().layout;
      update({ open: false, preparing: false, active: true, step: 0 });
    } catch (error) {
      if (cancelled()) return;
      this.close();
      update({ open: true, error: String(error) });
    }
  },
  next() {
    if (snapshot.step === 5) this.close();
    else {
      baseline = session.getSnapshot().layout;
      update({ step: snapshot.step + 1 });
    }
  },
};
runtime.app.subscribe(() => {
  if (!snapshot.active) return;
  if (snapshot.step === 0 && runtime.app.state.playing) practice.next();
});
transport.subscribe(() => {
  const time = transport.getSnapshot();
  if (snapshot.active) {
    if (snapshot.step === 1 && time.speed !== 1) practice.next();
    else if (snapshot.step === 2 && wasScrubbing && !time.scrubbing) practice.next();
  }
  wasScrubbing = time.scrubbing;
});
session.subscribe(() => {
  if (!snapshot.active) return;
  const layout = session.getSnapshot().layout;
  if (snapshot.step === 3 && (layout.a !== baseline.a || layout.b !== baseline.b)) practice.next();
  else if (snapshot.step === 4 && layout.theme !== baseline.theme) practice.next();
});
