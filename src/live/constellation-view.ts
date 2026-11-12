import { constellationLayout } from './constellation';
import type { LiveInstrument, LiveModel, LiveRoom } from './model';

export const words = (i: LiveInstrument, playing: boolean) =>
  i.error
    ? `Question failed: ${i.error}`
    : [
        i.silenced
          ? 'muted'
          : i.noteStarts === null
            ? 'not asked yet'
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
export const roomWords = (r: LiveRoom) =>
  `Room ${r.orbit} · ${
    r.conflict
      ? 'settings differ'
      : [r.reverb === null ? '' : `reverb ${r.reverb}`, r.delay === null ? '' : `delay ${r.delay}`]
          .filter(Boolean)
          .join(' · ')
  }`;
export function text(n: Element, value: string) {
  if (n.textContent !== value) n.textContent = value;
}
export const colour = (i: LiveInstrument) => `hsl(${(i.colour * 67 + 155) % 360} 65% 75%)`;
const svgNode = <K extends keyof SVGElementTagNameMap>(tag: K) =>
  document.createElementNS('http://www.w3.org/2000/svg', tag);

/** Real buttons retain native Enter/Space activation and the shell's focus
 * origin. Build once; clock frames only change attributes/classes/text. */
export function mountConstellation(
  host: HTMLElement,
  initial: LiveModel,
  onEdit?: (id: string, origin: HTMLElement) => void,
) {
  const drawing = document.createElement('div');
  drawing.className = 'constellation';
  drawing.setAttribute('role', 'group');
  drawing.setAttribute('aria-label', 'Instruments and shared rooms');
  drawing.classList.toggle('constellation-busy', initial.instruments.length > 12);
  const svg = svgNode('svg');
  svg.setAttribute('aria-hidden', 'true');
  drawing.append(svg);
  // At most one room per instrument. Reserve the nodes so section changes do
  // not replace focused controls or rebuild on playback acknowledgements.
  const regions = initial.instruments.map(() => {
    const rect = svgNode('rect');
    rect.setAttribute('rx', '12');
    svg.append(rect);
    const label = document.createElement('span');
    label.className = 'constellation-room';
    drawing.append(label);
    return { rect, label };
  });
  const description = document.createElement('p');
  description.className = 'constellation-description';
  const idle = 'Select an instrument to edit.';
  description.textContent = idle;
  const planets = new Map(
    initial.instruments.map((i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'constellation-planet';
      button.dataset.liveId = i.id;
      button.setAttribute('aria-controls', 'editor');
      const dot = document.createElement('span'),
        name = document.createElement('span');
      const mark = document.createElement('small');
      dot.className = 'live-dot';
      name.className = 'constellation-name';
      mark.className = 'constellation-mark';
      dot.setAttribute('aria-hidden', 'true');
      name.setAttribute('aria-hidden', 'true');
      mark.setAttribute('aria-hidden', 'true');
      button.append(dot, name, mark);
      button.onclick = () => onEdit?.(i.id, button);
      button.onfocus = button.onmouseenter = () => {
        description.textContent = button.title;
      };
      button.onblur = button.onmouseleave = () => {
        description.textContent = idle;
      };
      drawing.append(button);
      return [i.id, { button, dot, name, mark, until: 0 }];
    }),
  );
  const hint = document.createElement('p');
  hint.className = 'constellation-touch-hint';
  hint.textContent = 'Use List below to choose an instrument.';
  host.append(drawing, hint, description);
  let width = 240,
    key = '',
    established = false,
    touchList = initial.instruments.length > 12,
    previous: number | null = null,
    model = initial;
  const height = 300;
  function position() {
    const layout = constellationLayout(model, { width, height });
    touchList = model.instruments.length > 12 || layout.planets.some((p) => p.target < 44);
    drawing.classList.toggle('constellation-touch-list', touchList);
    drawing.style.height = `${height}px`;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    for (const p of layout.planets) {
      const b = planets.get(p.id)!.button;
      b.style.left = `${p.x - p.target / 2}px`;
      b.style.top = `${p.y - p.target / 2}px`;
      b.style.setProperty('--target', `${p.target}px`);
      b.style.setProperty('--centre', `${p.target / 2}px`);
      b.style.setProperty('--radius', `${p.r}px`);
      b.style.setProperty('--name-width', `${p.labelWidth}px`);
      b.dataset.x = String(p.x);
      b.dataset.y = String(p.y);
      b.dataset.r = String(p.r);
    }
    regions.forEach(({ rect, label }, n) => {
      const r = layout.regions[n];
      rect.style.display = r ? '' : 'none';
      label.hidden = !r;
      if (!r) return;
      for (const attr of ['x', 'y', 'width', 'height'] as const)
        rect.setAttribute(attr, String(r[attr]));
      label.style.left = `${r.label.x}px`;
      label.style.top = `${r.label.y}px`;
      label.style.width = `${r.width - 16}px`;
      text(label, roomWords(model.rooms.find((room) => room.orbit === r.orbit)!));
    });
  }
  const observer = new ResizeObserver((entries) => {
    const next = entries[0].contentRect.width;
    if (next > 0 && next !== width) {
      width = next;
      position();
    }
  });
  observer.observe(drawing);
  function update(next: LiveModel) {
    model = next;
    const nextKey = JSON.stringify([
      model.rooms,
      model.instruments.map((i) => [i.id, i.room, i.noteStarts]),
    ]);
    if (key !== nextKey) {
      const answered = model.instruments.every((i) => i.noteStarts !== null || i.error);
      drawing.classList.toggle('constellation-moving', established && answered);
      established = answered;
      key = nextKey;
      position();
    }
    const playing = model.cycle !== null,
      now = performance.now();
    for (const i of model.instruments) {
      const p = planets.get(i.id);
      if (!p) continue;
      const lit =
        playing &&
        !i.silenced &&
        !i.error &&
        i.lastOnset !== null &&
        (previous === null
          ? i.lastOnset === 0
          : model.cycle! >= previous && i.lastOnset > previous);
      if (lit) p.until = now + 250;
      p.button.classList.toggle('live-lit', lit);
      p.button.classList.toggle('live-glowing', playing && now < p.until);
      p.button.classList.toggle('live-playing', playing && i.inSection && !i.silenced && !i.error);
      p.button.classList.toggle('live-absent', !i.inSection && !i.error && i.noteStarts !== null);
      p.button.classList.toggle('live-hollow', i.silenced);
      p.button.classList.toggle('live-missing', i.sound === 'missing');
      p.button.classList.toggle('live-unknown', i.noteStarts === null && !i.error);
      p.button.classList.toggle('live-failed', !!i.error);
      p.button.classList.toggle('live-generated', i.nameSource === 'generated');
      p.button.dataset.lit = String(lit);
      p.dot.style.setProperty('--live-colour', colour(i));
      text(p.name, i.name);
      text(
        p.mark,
        i.error
          ? '⚠'
          : i.sound === 'missing'
            ? 'missing'
            : i.noteStarts === null
              ? '?'
              : i.sound === 'loading'
                ? 'loading'
                : i.sound === 'not-loaded'
                  ? 'not loaded'
                  : '',
      );
      const label = `${i.name}${i.nameSource === 'generated' ? ' (generated name)' : ''}, ${words(i, playing)}, ${i.room === null ? 'no room' : `Room ${i.room}`}`;
      if (p.button.getAttribute('aria-label') !== label) p.button.setAttribute('aria-label', label);
      p.button.title = label;
    }
    drawing.classList.toggle('live-stopped', !playing);
    previous = model.cycle;
  }
  update(initial);
  return {
    update,
    get touchList() {
      return touchList;
    },
    dispose: () => observer.disconnect(),
  };
}
