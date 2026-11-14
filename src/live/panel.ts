import type { LiveModel } from './model';
import { mountConstellation, words, membershipWords, text, colour } from './constellation-view';
import './style.css';
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  n.className = className;
  return n;
};
type Line = {
  button: HTMLButtonElement;
  name: HTMLElement;
  status: HTMLElement;
  dot: HTMLElement;
};
const panels = new WeakMap<
  HTMLElement,
  {
    summary: HTMLElement;
    list: HTMLElement;
    lines: Map<string, Line>;
    cycle: number | null;
    touchList: boolean;
    disclosure: HTMLDetailsElement;
    drawing: ReturnType<typeof mountConstellation>;
  }
>();
export function mountLivePanel(
  host: HTMLElement,
  model: LiveModel,
  handlers: { onEdit?(id: string, origin: HTMLElement): void } = {},
) {
  panels.get(host)?.drawing.dispose();
  const details = node('details', '', 'live-panel');
  details.open = !matchMedia('(max-width: 760px)').matches;
  const summary = node('summary');
  const names = node('span', '', 'live-summary-names');
  summary.append(node('h2', 'Now'), names);
  details.append(summary);
  const drawing = mountConstellation(details, model, handlers.onEdit);
  const disclosure = node('details', '', 'live-list-disclosure');
  disclosure.append(node('summary', `List · ${model.instruments.length} instruments · full names`));
  // Dense phone drawings delegate touch to the full-size list controls.
  disclosure.open = drawing.touchList && matchMedia('(max-width: 760px)').matches;
  const list = node('div', '', 'live-list');
  const more = node(
    'button',
    `${Math.max(0, model.instruments.length - 4)} more · ${model.instruments.length} total`,
    'live-list-more',
  );
  more.type = 'button';
  more.setAttribute('aria-expanded', 'false');
  const remaining = node('div', '', 'live-list-remaining');
  remaining.id = 'live-list-remaining';
  more.setAttribute('aria-controls', remaining.id);
  const setExpanded = (expanded: boolean) => {
    // Programmatic collapse also returns focus before hiding a focused child.
    if (!expanded && remaining.contains(document.activeElement)) more.focus();
    remaining.classList.toggle('live-list-expanded', expanded);
    more.setAttribute('aria-expanded', String(expanded));
    text(
      more,
      expanded
        ? `Show first 4 · ${model.instruments.length} total`
        : `${model.instruments.length - 4} more · ${model.instruments.length} total`,
    );
  };
  remaining.addEventListener('focusin', () => setExpanded(true));
  more.onclick = () => setExpanded(more.getAttribute('aria-expanded') !== 'true');
  const lines = new Map<string, Line>();
  for (const instrument of model.instruments) {
    const button = node('button', '', 'live-instrument');
    button.type = 'button';
    button.dataset.listId = instrument.id;
    button.setAttribute('aria-controls', 'editor');
    const dot = node('span', '', 'live-dot'),
      name = node('span'),
      status = node('small');
    dot.setAttribute('aria-hidden', 'true');
    button.append(dot, name, status);
    button.onclick = () => handlers.onEdit?.(instrument.id, button);
    (lines.size < 4 ? list : remaining).append(button);
    lines.set(instrument.id, { button, dot, name, status });
  }
  if (model.instruments.length > 4) list.append(more, remaining);
  disclosure.append(list);
  details.append(disclosure);
  host.replaceChildren(details);
  panels.set(host, {
    summary: names,
    list,
    lines,
    cycle: null,
    drawing,
    touchList: drawing.touchList,
    disclosure,
  });
  updateLivePanel(host, model);
}
/** No replacement nodes: focus, disclosure state and button identity survive frames. */
export function updateLivePanel(host: HTMLElement, model: LiveModel) {
  const panel = panels.get(host);
  if (!panel) return;
  // The engine counts in just before zero; that is not a previous song section.
  if (model.cycle !== null && model.cycle < 0) return;
  panel.drawing.update(model);
  if (panel.drawing.touchList && !panel.touchList && matchMedia('(max-width: 760px)').matches)
    panel.disclosure.open = true;
  panel.touchList = panel.drawing.touchList;
  const playing = model.cycle !== null;
  panel.list.classList.toggle('live-stopped', !playing);
  const active = model.instruments.filter((i) => i.inSection && !i.silenced && !i.error);
  text(
    panel.summary,
    `${active.length ? `: ${active.map((i) => i.name).join(', ')}` : ': no instruments playing'}`,
  );
  model.instruments.forEach((instrument) => {
    const line = panel.lines.get(instrument.id);
    if (!line) return;
    text(line.name, instrument.name);
    line.name.classList.toggle('live-generated', instrument.nameSource === 'generated');
    line.name.title = instrument.nameSource === 'generated' ? 'Generated instrument name' : '';
    text(line.status, `${words(instrument, playing)} · ${membershipWords(instrument, model)}`);
    line.dot.style.setProperty('--live-colour', colour(instrument));
    line.button.classList.toggle(
      'live-absent',
      !instrument.inSection && !instrument.error && instrument.noteStarts !== null,
    );
    line.button.classList.toggle(
      'live-playing',
      playing && instrument.inSection && !instrument.silenced && !instrument.error,
    );
    const lit =
      playing &&
      !instrument.silenced &&
      !instrument.error &&
      instrument.lastOnset !== null &&
      panel.cycle !== null &&
      model.cycle! >= panel.cycle &&
      instrument.lastOnset > panel.cycle;
    line.button.classList.toggle('live-lit', lit);
  });
  panel.cycle = model.cycle;
}
