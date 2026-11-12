import { describeTarget } from '../document';
import { definitionMuted, setMuted } from '../document/edits/set-muted';
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
  </div><p id="solo-banner" hidden><span></span> <button id="stop-solo">Stop solo</button></p><p id="message" role="status"></p><div id="sound-notice" hidden><span role="status">Default sounds could not load. Check your connection, then press Play again.</span><button id="dismiss-sound-notice" aria-label="Dismiss sound notice">Dismiss</button></div></header>
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
get('dismiss-sound-notice').onclick = () => app.dismissSoundNotice();
play.onclick = () => {
  void app.play();
};
stop.onclick = () => app.stop();
get('stop-solo').onclick = () => app.solo(null);
follow.onclick = () => app.follow(!app.state.follow);
let targetId: string | null = null,
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
const renderPanel = createPanel(get('editor'), closeEditor);
function renderEditor() {
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
          apply: (next, options) => {
            if (options?.selection) targetId = options.selection;
            app.editor?.apply(next, options, targetId ?? undefined);
            if (options?.selection) renderEditor();
          },
          ask: (candidate, id) => app.editor!.ask(candidate, id, fromCycle, toCycle),
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
          ? 'Changing — not playing yet'
          : entry?.status === 'failed'
            ? 'Change failed; previous value restored'
            : '';
  }
  get<HTMLButtonElement>('undo').disabled = !app.editor?.canUndo;
  get<HTMLButtonElement>('redo').disabled = !app.editor?.canRedo;
  fitEditor();
  // Keep the selected editor as the only editing surface.
  get<HTMLTextAreaElement>('source').disabled = !!targetId;
  get<HTMLButtonElement>('load').disabled = !!targetId;
  for (const b of Array.from(get('examples').querySelectorAll('button'))) b.disabled = !!targetId;
  for (const b of Array.from(score.querySelectorAll<HTMLButtonElement>('.sheet-mute')))
    b.disabled = !!targetId;
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
          origin = {
            id,
            control: cell.dataset.control,
            row: cell.closest<HTMLElement>('tr')?.dataset.nodeId,
          };
          targetId = id;
          renderEditor();
          originCell()?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          if (matchMedia('(max-width: 760px)').matches)
            score
              .querySelector<HTMLElement>('[data-section][aria-pressed="true"]')
              ?.scrollIntoView({ block: 'start', inline: 'nearest' });
          else {
            const editor = get('editor');
            if (editor.getBoundingClientRect().top < 16)
              window.scrollBy(0, editor.getBoundingClientRect().top - 16);
          }
          get('editor').querySelector<HTMLElement>('input,button')?.focus({ preventScroll: true });
        },
      },
    );
  }
  renderEditor();
});
function fitEditor() {
  const editor = get('editor');
  const height =
    editor.hidden || matchMedia('(max-width: 760px)').matches
      ? ''
      : `${Math.max(160, innerHeight - Math.max(16, editor.getBoundingClientRect().top) - 16)}px`;
  if (editor.style.maxHeight !== height) editor.style.maxHeight = height;
}
window.addEventListener('scroll', fitEditor, { passive: true });
window.addEventListener('resize', fitEditor);
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
