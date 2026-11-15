import type { App } from '../controller';
import type { createPreviews } from '../previews';
import { describeTarget } from '../../document/edit';
import { examples } from '../examples';
import { kilnTargets, lessons } from './targets';
import './style.css';

type Shell = {
  lock(value: boolean): void;
  park(): () => void;
  closeDialogs(): void;
  previews: ReturnType<typeof createPreviews>;
};
export function mountTour(app: App, shell: Shell) {
  const get = (id: string) => document.getElementById(id)!;
  const entry = document.createElement('dialog');
  entry.id = 'tour-entry';
  entry.className = 'about-dialog';
  entry.setAttribute('aria-labelledby', 'tour-entry-title');
  entry.innerHTML = `<h2 id="tour-entry-title">Practice on an original?</h2><p>Use Kiln, an original example. Practice changes will be discarded.</p><p>Your work, Undo and Redo, and unfinished input will be put aside in memory. Starting stops playback. Returning keeps it stopped. Recovery holds only your own document, not history or drafts, and browser storage can be unavailable or full.</p><p id="tour-preparing" role="status"></p><div class="load-actions"><button id="tour-start">Start practice</button><button id="tour-cancel">Cancel</button><button id="tour-stop">Stop</button></div>`;
  const guide = document.createElement('aside');
  guide.id = 'tour-guide';
  guide.hidden = true;
  guide.setAttribute('aria-label', 'Guided practice');
  guide.innerHTML = `<div class="tour-top"><strong>Practice</strong><button id="tour-end">End tour</button></div><p id="tour-announcement" class="sheet-sr-only" role="status" aria-live="polite" aria-atomic="true"></p><div id="tour-instructions" tabindex="0" aria-label="Lesson text, scroll for more"></div><div id="tour-actions"></div><p id="tour-paused" role="status" hidden>Required control unavailable. Practice paused.</p><button id="tour-retry" hidden>Retry</button><button id="tour-skip" hidden>Continue without playback</button>`;
  document.body.append(entry, guide);
  let generation = 0,
    run: AbortController | undefined,
    initiator: HTMLElement | null = null;
  let restore: (() => void) | undefined;
  let presenter: ReturnType<(typeof import('./driver'))['createGuide']> | undefined;
  let step = 0,
    completed = new Set<number>(),
    seen = new Set<string>();
  let pinned = false,
    edited = false,
    editSerial = 0,
    checking = false,
    queued = false;
  let shown: unknown[] = [],
    paused = false;
  const kiln = examples.find((example) => example.name === 'Kiln')!;
  function focusOrigin() {
    (initiator?.isConnected ? initiator : get('take-tour')).focus({ preventScroll: true });
  }
  function cancel() {
    ++generation;
    run?.abort();
    run = undefined;
    entry.close();
    shell.lock(false);
    focusOrigin();
  }
  function end() {
    if (!app.practice) {
      if (entry.open) cancel();
      return;
    }
    ++generation;
    run?.abort();
    run = undefined;
    presenter?.destroy();
    presenter = undefined;
    shell.previews.shrink(false);
    shell.closeDialogs();
    guide.hidden = true;
    document.body.classList.remove('practicing');
    app.endPractice(restore);
    restore = undefined;
    shell.lock(false);
    focusOrigin();
  }
  function request(button: HTMLElement) {
    if (entry.open || app.practice) return;
    initiator = button;
    shell.lock(true); // before showModal can blur/commit a field
    get('tour-preparing').textContent = '';
    (get('tour-start') as HTMLButtonElement).disabled = false;
    entry.showModal();
    get('tour-start').focus();
  }
  // Pointer entry captures before the browser's focus/change default action.
  document.addEventListener(
    'pointerdown',
    (event) => {
      const button = (event.target as Element).closest<HTMLElement>('[data-take-tour]');
      if (button) {
        event.preventDefault();
        request(button);
      }
    },
    true,
  );
  document.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-take-tour]');
    if (button) request(button);
  });
  get('tour-cancel').onclick = cancel;
  get('tour-stop').onclick = () => app.stop();
  entry.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancel();
  });
  get('tour-start').onclick = async () => {
    const own = ++generation;
    run = new AbortController();
    const signal = run.signal;
    (get('tour-start') as HTMLButtonElement).disabled = true;
    get('tour-preparing').textContent =
      'Settling submitted work… Stop and Cancel remain available.';
    try {
      // Load the presentation only on explicit entry, before switching sessions.
      const { createGuide } = await import('./driver');
      if (signal.aborted || own !== generation) return;
      const ok = await app.beginPractice(signal, () => {
        shell.previews.shrink(false);
        restore = shell.park();
      });
      if (signal.aborted || own !== generation) return;
      if (!ok) {
        get('tour-preparing').textContent =
          'Could not settle submitted work. Your session and its error are kept. Cancel to correct it, then try again.';
        (get('tour-start') as HTMLButtonElement).disabled = false;
        return;
      }
      entry.close();
      document.body.classList.add('practicing');
      guide.hidden = false;
      step = 0;
      completed = new Set();
      seen = new Set();
      pinned = edited = checking = false;
      shown = [];
      presenter = createGuide(get('tour-instructions'), next, back);
      refresh();
      get('tour-end').focus();
    } catch (error) {
      if (signal.aborted || own !== generation) return;
      if (app.practice) end();
      else {
        get('tour-preparing').textContent = String(error);
        (get('tour-start') as HTMLButtonElement).disabled = false;
      }
    }
  };
  function next() {
    if (paused || (!completed.has(step) && step !== 7)) return;
    if (step === 7) end();
    else {
      step++;
      shown = [];
      refresh();
    }
  }
  function back() {
    if (step > 0) {
      step--;
      shown = [];
      refresh();
    }
  }
  function complete() {
    if (completed.has(step)) return;
    completed.add(step);
    if (step < 7) step++;
    shown = [];
    refresh();
  }
  get('tour-end').onclick = end;
  get('tour-skip').onclick = () => {
    app.stop();
    complete();
  };
  get('tour-retry').onclick = () => {
    shown = [];
    refresh();
  };
  function refresh() {
    if (!app.practice || !presenter) return;
    const state = app.state,
      targets = state.doc && kilnTargets(state.doc);
    const section = (id: string) =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-section]')).find(
        (n) => n.dataset.section === id,
      );
    const cutoff =
      targets &&
      Array.from(document.querySelectorAll<HTMLElement>('[data-editor-target]')).find(
        (n) =>
          n.dataset.editorTarget === targets.cutoff &&
          n.closest('tr')?.dataset.nodeId === targets.bass,
      );
    const value =
      targets && state.doc ? describeTarget(state.doc, targets.cutoff).value : undefined;
    const ready =
      state.doc &&
      app.canPlay &&
      state.rows.every((row) => state.events[row.id] && !state.events[row.id].error);
    const revisiting = completed.has(step);
    if (!revisiting) {
      if (step === 0 && state.source === kiln.source && ready && targets) {
        complete();
        return;
      }
      if (step === 1 && state.playing) {
        complete();
        return;
      }
      if (
        step === 2 &&
        targets &&
        state.selected === targets.first.id &&
        !state.follow &&
        cutoff &&
        ready
      ) {
        complete();
        return;
      }
      if (step === 3 && value !== undefined && value !== 700 && !checking) {
        checking = true;
        const own = generation,
          session = app.editor;
        void session!.settle().then((ok) => {
          if (own !== generation) return;
          checking = false;
          if (own !== generation || step !== 3 || !app.practice || session !== app.editor) return;
          if (ok && describeTarget(app.state.doc!, targets!.cutoff).value !== 700) {
            edited = true;
            editSerial = session!.operation.serial;
            complete();
          }
        });
      }
      if (
        step === 4 &&
        edited &&
        get('editor').hidden &&
        value === 700 &&
        app.editor?.operation.kind === 'undo' &&
        app.editor.operation.serial > editSerial
      ) {
        complete();
        return;
      }
      if (step === 5 && targets) {
        if (state.selected === targets.next.id && !state.follow) pinned = true;
        if (pinned && state.follow) {
          complete();
          return;
        }
      }
      if (step === 6 && seen.has('now') && seen.has('watch')) {
        complete();
        return;
      }
    }
    const expanded = shell.previews.current;
    const keepOpen = !get('keep-panel').hidden;
    const target = [
      Array.from(get('examples').querySelectorAll('button')).find((n) => n.textContent === 'Kiln'),
      get('play'),
      targets && section(targets.first.id),
      !get('editor').hidden
        ? get('editor').querySelector<HTMLElement>('input[type="number"]')
        : cutoff,
      !get('editor').hidden
        ? get('editor').querySelector<HTMLElement>('.editor-done')
        : get('undo'),
      pinned ? get('follow') : targets && section(targets.next.id),
      expanded ? get('preview-close') : get(seen.has('now') ? 'watch' : 'now-enlarge'),
      get(keepOpen ? 'download-document' : 'keep'),
    ][step];
    get('tour-skip').hidden = step !== 1;
    paused = !target || !target.isConnected || target.getClientRects().length === 0;
    get('tour-paused').hidden = !paused;
    get('tour-retry').hidden = !paused;
    if (paused) {
      presenter.destroy();
      shown = [];
      return;
    }
    const key = [step, target, revisiting, keepOpen];
    if (key.some((item, i) => item !== shown[i])) {
      shown = key;
      get('tour-announcement').textContent =
        `${step + 1} of 8. ${lessons[step][0]}. ${lessons[step][1]}`;
      presenter.show(target!, step, lessons[step][0], lessons[step][1], revisiting || step === 7);
    }
  }
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      refresh();
    });
  };
  app.subscribe(schedule);
  shell.previews.subscribe((kind, open) => {
    if (app.practice && !open && kind) seen.add(kind);
    schedule();
  });
  const geometry = new ResizeObserver(() => {
    document.body.style.setProperty(
      '--tour-header',
      `${document.querySelector('.topbar')!.getBoundingClientRect().bottom + 8}px`,
    );
    document.body.style.setProperty(
      '--tour-guide-height',
      `${guide.getBoundingClientRect().height + 8}px`,
    );
  });
  geometry.observe(document.querySelector('.topbar')!);
  geometry.observe(guide);
  new MutationObserver(schedule).observe(document.querySelector('main')!, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  window.addEventListener(
    'keydown',
    (event) => {
      if (!app.practice && !entry.open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (app.practice) end();
        else cancel();
      }
      // Driver 1.10.2 owns a bubble-phase Tab trap independent of keyboard control.
      // Keep native Tab order through transport, forms, nonmodal preview and guide.
      else if (app.practice && event.key === 'Tab') event.stopImmediatePropagation();
    },
    true,
  );
}
