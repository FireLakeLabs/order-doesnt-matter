import { pendingWords } from '../editor/pending';
import { describeTarget } from '../document/edit';
import { definitionMuted, setMuted } from '../document/edits/set-muted';
import { createPanel } from '../editor/panel';
import { createApp } from './controller';
import { examples } from './examples';
import { sheetModel, mountSheet, setPlayhead, setCurrentSection } from '../sheet';
import { liveModel, mountLivePanel, updateLivePanel } from '../live';
import { livePlayhead } from '../live/playhead';
import { contextLabels } from './context';
import { createPreviews, previewMarkup } from './previews';
import { aboutControls, mountAbout } from './about';
import { keepMarkup, mountKeep } from './keep';
import './style.css';

const app = createApp({ confirmReplacement: () => keep.confirmReplacement() });
document.body.innerHTML = `
  <header class="topbar"><h1>Order Doesn't Matter</h1><div class="transport">
    <button id="play" disabled>Play</button><button id="stop" disabled>Stop</button>
    <output id="tempo" aria-label="Tempo">Tempo —</output>
    <button id="undo" disabled>Undo</button><button id="redo" disabled>Redo</button>
    <button id="paste" aria-expanded="true" aria-controls="paste-panel">Paste Strudel</button>
  <button id="keep" aria-expanded="false" aria-controls="keep-panel">Keep work</button>
  ${aboutControls}</div><p id="solo-banner" hidden><span></span> <button id="stop-solo">Stop solo</button></p><p id="message" role="status"></p><div id="sound-notice" hidden><span role="status">Default sounds could not load. Check your connection, then press Play again.</span><button id="dismiss-sound-notice" aria-label="Dismiss sound notice">Dismiss</button></div></header>
  <main>
    ${keepMarkup}
    <section id="paste-panel" aria-label="Paste Strudel">
      <label for="source">Your Strudel program</label>
      <textarea id="source" spellcheck="false" placeholder='s("bd*2, hh*4, ~ cp")' aria-describedby="load-error"></textarea>
      <div class="load-actions"><button id="load">Load</button><span>Try an original:</span><div id="examples"></div></div>
      <p id="load-error" role="alert"></p>
    </section>
    <details id="notes" hidden><summary>Notes</summary><ul></ul></details>
    <div class="score-toolbar"><h2>The score</h2><span id="editing-context"></span><output id="window"></output><button id="follow" aria-pressed="true">Follow</button></div>
    <p id="playback-context" aria-live="polite"></p>
    <div id="score-workspace"><div id="score"><p class="welcome">Paste a Strudel program or choose an original to see its score. Press Play when you're ready.</p></div><aside id="editor" hidden></aside>${previewMarkup}</div>
  </main><footer>Read the score. Follow the cycles.</footer>`;
const aboutDialog = mountAbout();
const keep = mountKeep(app);
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
let source = get<HTMLTextAreaElement>('source'),
  score = get('score');
const paste = get<HTMLButtonElement>('paste'),
  panel = get('paste-panel');
const play = get<HTMLButtonElement>('play'),
  stop = get<HTMLButtonElement>('stop');
const previews = createPreviews(),
  spiral = previews.spiral;
const follow = get<HTMLButtonElement>('follow');
paste.onclick = () => {
  panel.hidden = !panel.hidden;
  paste.setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) source.focus();
};
get('load').onclick = () => {
  void app.load(source.value);
};
for (const example of examples) {
  const button = document.createElement('button');
  button.textContent = example.name;
  button.onclick = () => {
    source.value = example.source;
    void app.load(example.source);
  };
  get('examples').append(button);
}
get('dismiss-sound-notice').onclick = () => app.dismissSoundNotice();
play.onclick = () => {
  void app.play();
};
stop.onclick = () => app.stop();
get('stop-solo').onclick = () => app.solo(null);
follow.onclick = () => app.follow(!app.state.follow);
let editNotice: { doc: unknown; text: string } | undefined;
let targetId: string | null = null,
  selectedSession: typeof app.editor;
let origin: { id: string; control?: string; row?: string } | null = null;
let liveOrigin: HTMLElement | null = null;
function originCell() {
  return Array.from(score.querySelectorAll<HTMLElement>('[data-editor-target]')).find(
    (n) =>
      n.dataset.editorTarget === origin?.id &&
      n.dataset.control === origin?.control &&
      n.closest<HTMLElement>('tr')?.dataset.nodeId === origin?.row,
  );
}
function closeEditor() {
  targetId = null;
  renderEditor();
  (liveOrigin?.isConnected ? liveOrigin : originCell())?.focus();
}
let renderPanel = createPanel(get('editor'), closeEditor);
let entryLocked = false;
function renderEditor() {
  if (entryLocked) return;
  const owner = app.editor;
  const { doc, playing, fromCycle, toCycle } = app.state;
  const target = doc && targetId ? describeTarget(doc, targetId) : null;
  get('score-workspace').classList.toggle('editing', !!target);
  const entry = targetId ? app.editor?.state.entries[targetId] : undefined;
  const events = target?.instrumentId ? app.state.events[target.instrumentId] : undefined;
  renderPanel(
    target && doc
      ? {
          doc,
          target,
          instrument: {
            sounds: app.state.sounds,
            solo: app.state.solo,
            setSolo: (id) => app.solo(id),
          },
          events: events
            ? {
                ...events,
                events: events.events.filter((e) => e.part[0] < toCycle && e.part[1] > fromCycle),
              }
            : undefined,
          window: { fromCycle: app.state.fromCycle, toCycle: app.state.toCycle },
          pending: entry?.status ?? 'none',
          submit: (work) => owner!.submit(work),
          apply: (next, options) => {
            if (app.editor !== owner) return;
            const oldRows = app.state.rows;
            const oldIndex = oldRows.findIndex((r) => r.id === targetId);
            if (options?.selection !== undefined) targetId = options.selection ?? null;
            if (options?.announcement) editNotice = { doc: next, text: options.announcement };
            app.editor?.apply(next, options, targetId ?? undefined);
            if (options?.selection !== undefined) renderEditor();
            if (options?.selection === null) {
              const neighbour =
                app.state.rows[Math.min(Math.max(oldIndex, 0), app.state.rows.length - 1)];
              Array.from(score.querySelectorAll<HTMLElement>('th[data-editor-target]'))
                .find((n) => n.dataset.editorTarget === neighbour?.id)
                ?.focus({ preventScroll: true });
            }
          },
          ask: (candidate, id) => owner!.ask(candidate, id, fromCycle, toCycle),
        }
      : null,
    entry,
    playing,
  );
  for (const n of Array.from(score.querySelectorAll<HTMLElement>('[data-editor-target]'))) {
    const selected = !!targetId && n === originCell(),
      entry = app.editor?.state.entries[n.dataset.editorTarget!];
    n.dataset.editorSelected = String(selected);
    n.setAttribute('aria-expanded', String(selected));
    n.dataset.editState = entry?.status ?? '';
    let status = n.querySelector('.edit-status');
    if (entry && !status) {
      status = document.createElement('small');
      status.className = 'edit-status';
      n.append(status);
    }
    if (status)
      status.textContent =
        entry?.status === 'pending'
          ? pendingWords(entry)
          : entry?.status === 'failed'
            ? 'Change failed; previous value restored'
            : '';
  }
  get<HTMLButtonElement>('undo').disabled = !app.editor?.canUndo;
  get<HTMLButtonElement>('redo').disabled = !app.editor?.canRedo;
  // Keep the selected editor as the only editing surface.
  get<HTMLTextAreaElement>('source').disabled = !!targetId;
  get<HTMLButtonElement>('load').disabled = !!targetId;
  for (const b of Array.from(get('examples').querySelectorAll('button'))) b.disabled = !!targetId;
  for (const id of ['open-document', 'recover']) get<HTMLButtonElement>(id).disabled = !!targetId;
  for (const b of Array.from(score.querySelectorAll<HTMLButtonElement>('.sheet-mute')))
    b.disabled = !!targetId;
}
function openEditor(id: string, cell: HTMLElement) {
  origin = {
    id,
    control: cell.dataset.control,
    row:
      cell.dataset.liveId ?? cell.dataset.listId ?? cell.closest<HTMLElement>('tr')?.dataset.nodeId,
  };
  targetId = id;
  renderEditor();
  get('editor').scrollIntoView({ block: 'nearest' });
  get('editor').querySelector<HTMLElement>('input,button')?.focus({ preventScroll: true });
}
get('undo').onclick = () => app.editor?.undo();
get('redo').onclick = () => app.editor?.redo();
document.addEventListener('keydown', (event) => {
  if (aboutDialog.open || keep.dialog.open) return;
  if (event.key === 'Escape' && previews.escape()) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape' && targetId) {
    event.preventDefault();
    closeEditor();
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'z' &&
    event.target !== source
  ) {
    event.preventDefault();
    if (event.shiftKey) app.editor?.redo();
    else app.editor?.undo();
  }
});
// Entry fences blur commits before moving focus. Park the actual mounted kind,
// including its closures, errors, selection and scroll; never serialize a form.
get('editor').addEventListener(
  'change',
  (event) => {
    if (entryLocked) {
      event.stopImmediatePropagation();
    }
  },
  true,
);
function parkOriginal() {
  const saved = {
    source,
    score,
    renderPanel,
    targetId,
    origin,
    liveOrigin,
    selectedSession,
    previousSheet,
    previousNotes,
    editNotice,
    editor: get('editor'),
    pasteHidden: panel.hidden,
    keepHidden: get('keep-panel').hidden,
    scroll: [window.scrollX, window.scrollY],
  };
  for (const id of ['source', 'score', 'editor'] as const) {
    const node = saved[id],
      replacement = document.createElement(node.tagName);
    replacement.id = id;
    if (id === 'editor') replacement.hidden = true;
    node.replaceWith(replacement);
  }
  source = get<HTMLTextAreaElement>('source');
  score = get('score');
  renderPanel = createPanel(get('editor'), closeEditor);
  targetId = null;
  origin = null;
  liveOrigin = null;
  selectedSession = null;
  previousSheet = [];
  previousNotes = undefined;
  editNotice = undefined;
  panel.hidden = false;
  get('keep-panel').hidden = true;
  entryLocked = false;
  return () => {
    renderPanel(null, undefined, false);
    for (const id of ['source', 'score', 'editor'] as const) get(id).replaceWith(saved[id]);
    ({
      source,
      score,
      renderPanel,
      targetId,
      origin,
      liveOrigin,
      selectedSession,
      previousSheet,
      previousNotes,
      editNotice,
    } = saved);
    panel.hidden = saved.pasteHidden;
    get('keep-panel').hidden = saved.keepHidden;
    paste.setAttribute('aria-expanded', String(!panel.hidden));
    get('keep').setAttribute('aria-expanded', String(!get('keep-panel').hidden));
    window.scrollTo(...(saved.scroll as [number, number]));
  };
}
let previousLiveRows = '';
let previousNotes: unknown;
let previousSheet: unknown[] = [];
app.subscribe((state) => {
  if (app.editor !== selectedSession) {
    targetId = null;
    selectedSession = app.editor;
    if (!state.source) source.value = '';
  }
  get('live-previews').hidden = !state.doc;
  app.setWatch(!!state.doc && !document.hidden);
  get('watch-message').textContent = state.message;
  get('watch-message').dataset.kind = app.warning ? 'warning' : 'error';
  play.disabled = !app.canPlay || state.playing;
  stop.disabled = !state.playing && !state.message.includes('Preparing');
  get('tempo').textContent =
    state.cps === null ? 'Tempo —' : `${Number((state.cps * 60).toFixed(2))} cycles/min`;
  get('message').textContent =
    state.message || (editNotice?.doc === state.doc ? editNotice.text : '');
  get('message').dataset.kind = app.warning ? 'warning' : 'error';
  get('sound-notice').hidden = !state.soundNotice.visible;
  get('solo-banner').hidden = !state.solo;
  get('solo-banner').querySelector('span')!.textContent =
    `Solo: ${state.rows.find((r) => r.id === state.solo)?.name.replaceAll('$', '') ?? ''} —`;
  get('load-error').textContent = state.loadError;
  follow.setAttribute('aria-pressed', String(state.follow));
  get('window').textContent = state.doc ? `Cycles ${state.fromCycle}–${state.toCycle}` : '';
  if (previousNotes !== state.warnings) {
    previousNotes = state.warnings;
    const notes = get<HTMLDetailsElement>('notes');
    notes.hidden = !state.warnings.length;
    notes.querySelector('summary')!.textContent = `Notes (${state.warnings.length})`;
    notes.querySelector('ul')!.replaceChildren(
      ...state.warnings.map((w) => {
        const li = document.createElement('li');
        li.textContent = w.message;
        return li;
      }),
    );
  }
  const inputs = [
    state.doc,
    state.events,
    state.sounds,
    state.fromCycle,
    state.toCycle,
    state.selected,
    state.playing,
  ];
  if (state.doc && inputs.some((value, i) => value !== previousSheet[i])) {
    previousSheet = inputs;
    mountSheet(
      score,
      sheetModel({ ...state, doc: state.doc, playhead: app.engine?.now() ?? null }),
      {
        selected: state.selected,
        definitionMuted: (id) => definitionMuted(state.doc!, id),
        onMute: (id, muted) => {
          if (targetId || state.doc !== app.state.doc) return;
          const next = setMuted(state.doc!, id, muted);
          if (!('ok' in next)) app.editor?.apply(next, {}, id);
        },
        onSelect: (id) => app.select(id),
        onEdit: (id, _summary, cell) => {
          liveOrigin = null;
          openEditor(id, cell);
        },
      },
    );
  }
  const liveRows = JSON.stringify(state.rows.map((r) => r.id));
  if (previousLiveRows !== liveRows) {
    previousLiveRows = liveRows;
    mountLivePanel(
      get('live'),
      liveModel({
        ...state,
        playhead: app.engine?.now() ?? null,
        outputLatency: app.engine?.outputLatency() ?? 0,
      }),
      {
        onEdit: (id, line) => {
          if (targetId) return;
          liveOrigin = line;
          openEditor(id, line);
        },
      },
    );
    get('live').querySelector('h2')!.id = 'now-title';
  }
  updateLivePanel(
    get('live'),
    liveModel({
      ...state,
      playhead: app.engine?.now() ?? null,
      outputLatency: app.engine?.outputLatency() ?? 0,
    }),
  );
  renderEditor();
});
document.addEventListener('visibilitychange', () =>
  app.setWatch(!!app.state.doc && !document.hidden),
);
function frame() {
  const now = app.frame(),
    { fromCycle, toCycle, sections } = app.state;
  updateLivePanel(
    get('live'),
    liveModel({ ...app.state, playhead: now, outputLatency: app.engine?.outputLatency() ?? 0 }),
  );
  if (app.state.doc && !document.hidden) spiral.update(app.watchInput(now));
  const labels = contextLabels(
    sections,
    fromCycle,
    livePlayhead(now, app.state.cps ?? 0, app.engine?.outputLatency() ?? 0),
  );
  for (const [id, value] of [
    ['editing-context', labels.editing],
    ['playback-context', labels.playback],
  ]) {
    const text = app.state.doc ? value : '';
    if (get(id).textContent !== text) get(id).textContent = text;
  }
  setPlayhead(score, now === null ? null : ((now - fromCycle) / (toCycle - fromCycle)) * 100);
  const last = sections.at(-1);
  setCurrentSection(score, now, last ? last.start + last.cycles : 0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Opt-in diagnostics. Bounded event history; no engine is created by inspection.
if (new URLSearchParams(location.search).has('inspect'))
  Object.defineProperties(window, { odmApp: { value: app }, odmSpiral: { value: spiral } });
declare global {
  interface Window {
    odmApp: typeof app;
    odmSpiral: typeof spiral;
  }
}
