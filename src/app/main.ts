import { describeTarget } from '../document';
import { createPanel } from '../editor/panel';
import { createApp } from './controller';
import { examples } from './examples';
import { sheetModel, mountSheet, setPlayhead, setCurrentSection } from '../sheet';
import './style.css';

const app = createApp();
document.body.innerHTML = `
  <header class="topbar"><h1>Order Doesn't Matter</h1><div class="transport">
    <button id="play" disabled>Play</button><button id="stop" disabled>Stop</button>
    <output id="tempo" aria-label="Tempo">Tempo —</output>
    <button id="undo" disabled>Undo</button><button id="redo" disabled>Redo</button>
    <button id="paste" aria-expanded="true" aria-controls="paste-panel">Paste Strudel</button>
  </div><p id="message" role="status"></p></header>
  <main>
    <section id="paste-panel" aria-label="Paste Strudel">
      <label for="source">Your Strudel program</label>
      <textarea id="source" spellcheck="false" placeholder='s("bd*2, hh*4, ~ cp")' aria-describedby="load-error"></textarea>
      <div class="load-actions"><button id="load">Load</button><span>Try an original:</span><div id="examples"></div></div>
      <p id="load-error" role="alert"></p>
    </section>
    <details id="notes" hidden><summary>Notes</summary><ul></ul></details>
    <div class="score-toolbar"><h2>The score</h2><button id="follow" aria-pressed="true">Follow</button><output id="window"></output></div>
    <div id="score-workspace"><div id="score"><p class="welcome">Paste a Strudel program or choose an original to see its score. Press Play when you're ready.</p></div><aside id="editor" hidden></aside></div>
  </main><footer>Read the score. Follow the cycles.</footer>`;
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const source = get<HTMLTextAreaElement>('source'),
  score = get('score');
const paste = get<HTMLButtonElement>('paste'),
  panel = get('paste-panel');
const play = get<HTMLButtonElement>('play'),
  stop = get<HTMLButtonElement>('stop');
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
play.onclick = () => {
  void app.play();
};
stop.onclick = () => app.stop();
follow.onclick = () => app.follow(!app.state.follow);
let targetId: string | null = null,
  targetSummary = '',
  selectedSession: typeof app.editor;
let origin: { id: string; control?: string; row?: string } | null = null;
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
  originCell()?.focus();
}
const renderPanel = createPanel(
  get('editor'),
  (value, gesture) => {
    if (targetId) app.editor?.edit(targetId, value, gesture);
  },
  closeEditor,
);
function renderEditor() {
  const { doc, playing } = app.state;
  const target = doc && targetId ? describeTarget(doc, targetId) : null;
  renderPanel(
    target,
    targetId ? app.editor?.state.entries[targetId] : undefined,
    playing,
    targetSummary,
  );
  for (const n of Array.from(score.querySelectorAll<HTMLElement>('[data-editor-target]'))) {
    const selected = n.dataset.editorTarget === targetId,
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
          ? 'changing — not heard yet'
          : entry?.status === 'failed'
            ? 'Change failed; previous value restored'
            : '';
  }
  get<HTMLButtonElement>('undo').disabled = !app.editor?.canUndo;
  get<HTMLButtonElement>('redo').disabled = !app.editor?.canRedo;
  // Keep the single setting editor as the only editing surface.
  get<HTMLTextAreaElement>('source').disabled = !!targetId;
  get<HTMLButtonElement>('load').disabled = !!targetId;
  for (const b of Array.from(get('examples').querySelectorAll('button'))) b.disabled = !!targetId;
}
get('undo').onclick = () => app.editor?.undo();
get('redo').onclick = () => app.editor?.redo();
document.addEventListener('keydown', (event) => {
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
let previousNotes: unknown;
let previousSheet: unknown[] = [];
app.subscribe((state) => {
  if (app.editor !== selectedSession) {
    targetId = null;
    selectedSession = app.editor;
  }
  play.disabled = !app.canPlay || state.playing;
  stop.disabled = !state.playing && !state.message.includes('Preparing');
  get('tempo').textContent =
    state.cps === null ? 'Tempo —' : `${Number((state.cps * 60).toFixed(2))} cycles/min`;
  get('message').textContent = state.message;
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
  ];
  if (state.doc && inputs.some((value, i) => value !== previousSheet[i])) {
    previousSheet = inputs;
    mountSheet(
      score,
      sheetModel({ ...state, doc: state.doc, playhead: app.engine?.now() ?? null }),
      {
        selected: state.selected,
        onSelect: (id) => app.select(id),
        onEdit: (id, summary, cell) => {
          origin = {
            id,
            control: cell.dataset.control,
            row: cell.closest<HTMLElement>('tr')?.dataset.nodeId,
          };
          targetId = id;
          targetSummary = summary;
          renderEditor();
          originCell()?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          get('editor').querySelector<HTMLElement>('input,button')?.focus({ preventScroll: true });
        },
      },
    );
  }
  renderEditor();
});
function frame() {
  const now = app.frame(),
    { fromCycle, toCycle, sections } = app.state;
  setPlayhead(score, now === null ? null : ((now - fromCycle) / (toCycle - fromCycle)) * 100);
  const last = sections.at(-1);
  setCurrentSection(score, now, last ? last.start + last.cycles : 0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Opt-in diagnostics. Bounded event history; no engine is created by inspection.
if (new URLSearchParams(location.search).has('inspect'))
  Object.defineProperty(window, 'odmApp', { value: app });
declare global {
  interface Window {
    odmApp: typeof app;
  }
}
