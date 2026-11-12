import type { LiveInstrument, LiveModel, LiveRoom } from './model';
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
    headings: HTMLElement[];
    cycle: number | null;
  }
>();
const words = (i: LiveInstrument, playing: boolean) =>
  i.error
    ? `Question failed: ${i.error}`
    : [
        i.silenced
          ? 'muted'
          : !i.inSection
            ? 'sits out this section'
            : playing
              ? 'playing'
              : 'stopped',
        i.sound === 'missing'
          ? 'sound missing'
          : i.sound === 'not-loaded'
            ? 'not loaded yet'
            : i.sound === 'loading'
              ? 'sound loading'
              : '',
      ]
        .filter(Boolean)
        .join(' · ');
const roomWords = (r: LiveRoom) =>
  `Room ${r.orbit} · ${
    r.conflict
      ? 'settings differ'
      : [r.reverb === null ? '' : `reverb ${r.reverb}`, r.delay === null ? '' : `delay ${r.delay}`]
          .filter(Boolean)
          .join(' · ')
  }`;
function text(n: HTMLElement, value: string) {
  if (n.textContent !== value) n.textContent = value;
}
export function mountLivePanel(
  host: HTMLElement,
  model: LiveModel,
  handlers: { onEdit?(id: string, origin: HTMLElement): void } = {},
) {
  const details = node('details', '', 'live-panel');
  details.open = !matchMedia('(max-width: 760px)').matches;
  const summary = node('summary');
  const names = node('span', '', 'live-summary-names');
  summary.append(node('h2', 'Now'), names);
  details.append(summary);
  const list = node('div', '', 'live-list');
  const headings = Array.from({ length: model.instruments.length + 1 }, () => node('h3'));
  list.append(...headings);
  const lines = new Map<string, Line>();
  for (const instrument of model.instruments) {
    const button = node('button', '', 'live-instrument');
    button.type = 'button';
    button.dataset.liveId = instrument.id;
    button.setAttribute('aria-controls', 'editor');
    const dot = node('span', '', 'live-dot'),
      name = node('span'),
      status = node('small');
    dot.setAttribute('aria-hidden', 'true');
    button.append(dot, name, status);
    button.onclick = () => handlers.onEdit?.(instrument.id, button);
    list.append(button);
    lines.set(instrument.id, { button, dot, name, status });
  }
  details.append(list);
  host.replaceChildren(details);
  panels.set(host, { summary: names, list, lines, headings, cycle: null });
  updateLivePanel(host, model);
}
/** No replacement nodes: focus, disclosure state and button identity survive frames. */
export function updateLivePanel(host: HTMLElement, model: LiveModel) {
  const panel = panels.get(host);
  if (!panel) return;
  const playing = model.cycle !== null;
  panel.list.classList.toggle('live-stopped', !playing);
  const active = model.instruments.filter((i) => i.inSection && !i.silenced && !i.error);
  text(
    panel.summary,
    `${active.length ? `: ${active.map((i) => i.name).join(', ')}` : ': no instruments playing'}`,
  );
  const groups = [
    ...model.rooms.map((r) => ({ room: r.orbit, text: roomWords(r) })),
    { room: null, text: 'No room' },
  ];
  panel.headings.forEach((heading, index) => {
    heading.hidden = index >= groups.length;
    if (groups[index]) {
      text(heading, groups[index].text);
      heading.style.order = String(index * (model.instruments.length + 1));
    }
  });
  model.instruments.forEach((instrument, index) => {
    const line = panel.lines.get(instrument.id);
    if (!line) return;
    text(line.name, instrument.name);
    line.name.classList.toggle('live-generated', instrument.nameSource === 'generated');
    line.name.title = instrument.nameSource === 'generated' ? 'Generated instrument name' : '';
    text(line.status, words(instrument, playing));
    line.dot.style.setProperty(
      '--live-colour',
      `hsl(${(instrument.colour * 67 + 155) % 360} 65% 75%)`,
    );
    line.button.style.order = String(
      groups.findIndex((g) => g.room === instrument.room) * (model.instruments.length + 1) +
        index +
        1,
    );
    line.button.classList.toggle('live-absent', !instrument.inSection && !instrument.error);
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
    line.button.dataset.lit = String(lit);
  });
  panel.cycle = model.cycle;
}
