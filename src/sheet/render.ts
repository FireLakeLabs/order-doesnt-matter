import type { Cell, SheetModel } from './model';
import './style.css';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
const svgElement = (tag: string, attributes: Record<string, string | number>) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
};
function drawing(cell: Cell) {
  const svg = svgElement('svg', {
    viewBox: '0 0 100 36',
    'aria-hidden': 'true',
    preserveAspectRatio: 'none',
  });
  svg.append(svgElement('path', { d: 'M0,34 H100', class: 'sheet-axis' }));
  if (cell.path) svg.append(svgElement('path', { d: cell.path, class: 'sheet-curve' }));
  cell.marks
    .filter((m) => !m.signal)
    .forEach((m) =>
      svg.append(svgElement('rect', { x: m.x, y: m.y, width: m.width, height: 3, rx: 0.5 })),
    );
  svg.append(svgElement('path', { d: 'M0,0 V36', class: 'sheet-playhead' }));
  return svg;
}

/** Rendering only: the model owns values, ordering, descriptions and geometry. */
export function mountSheet(
  host: HTMLElement,
  model: SheetModel,
  options: {
    selected?: string | null;
    onSelect?(id: string): void;
    onMute?(id: string, muted: boolean): void;
    definitionMuted?(id: string): boolean;
    onEdit?(id: string, summary: string, origin: HTMLElement): void;
  } = {},
): void {
  function selectable(node: HTMLElement, id: string, summary: string) {
    if (!options.onEdit) return;
    node.tabIndex = 0;
    node.dataset.editorTarget = id;
    node.dataset.nodeId = id;
    node.setAttribute('aria-controls', 'editor');
    node.onclick = (event) => {
      event.stopPropagation();
      options.onEdit?.(id, summary, node);
    };
    node.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        options.onEdit?.(id, summary, node);
      }
    };
  }
  const scrollers = Array.from(host.querySelectorAll<HTMLElement>('.sheet-scroll')).map((el) => ({
    left: el.scrollLeft,
    top: el.scrollTop,
  }));
  const focus = document.activeElement;
  const targetFocus =
    focus instanceof HTMLElement && host.contains(focus)
      ? {
          id: focus.dataset.editorTarget,
          control: focus.dataset.control,
          row: focus.closest<HTMLElement>('tr')?.dataset.nodeId,
        }
      : undefined;
  const muteFocus = focus instanceof HTMLElement ? focus.dataset.muteId : undefined;
  const sectionFocus =
    focus instanceof HTMLButtonElement && host.contains(focus) ? focus.dataset.section : undefined;
  const scrollFocus = Array.from(host.querySelectorAll('.sheet-scroll')).indexOf(focus as Element);
  const sheet = element('section', '', 'odm-sheet');
  sheet.setAttribute('aria-label', 'Score sheet');
  sheet.append(element('p', model.caption, 'sheet-caption'));
  if (model.sections.length) {
    const strip = element('section', '', 'sheet-song');
    strip.setAttribute('aria-label', 'Song sections');
    strip.append(element('h2', 'Song strip'));
    const scroll = element('div', '', 'sheet-scroll'),
      list = element('ol', '', 'sheet-sections');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Song strip, scroll for more sections');
    model.sections.forEach((section) => {
      const item = element('li', '', section.current ? 'sheet-current' : '');
      item.dataset.nodeId = section.nodeId;
      item.style.flexBasis = `${section.width}%`;
      const button = element('button');
      button.type = 'button';
      button.dataset.section = section.nodeId;
      button.dataset.nodeId = section.nodeId;
      button.dataset.start = String(section.start);
      button.dataset.end = String(section.start + section.cycles);
      button.setAttribute('aria-pressed', String(options.selected === section.nodeId));
      button.setAttribute('aria-label', section.name);
      button.onclick = () => options.onSelect?.(section.nodeId);
      if (section.current) button.setAttribute('aria-current', 'true');
      button.append(
        element('strong', section.name),
        element(
          'span',
          `${section.cycles} cycle${section.cycles === 1 ? '' : 's'} · ${section.start}–${section.start + section.cycles}`,
        ),
      );
      button.append(
        element('small', options.selected === section.nodeId ? 'Selected' : '', 'sheet-selection'),
      );
      button.append(element('small', section.current ? 'Playing now' : '', 'sheet-playing'));
      item.append(button);
      if (options.onEdit) {
        const edit = element('button', 'Edit', 'sheet-section-edit');
        edit.type = 'button';
        edit.setAttribute('aria-label', `Edit section ${section.name}`);
        selectable(edit, section.nodeId, section.name);
        item.append(edit);
      }
      const present = section.instruments.filter(
        (instrument) => instrument.state === 'present',
      ).length;
      const membership = element(
        'small',
        `${present} in · ${section.instruments.length - present} out`,
        'sheet-membership',
      );
      button.append(membership);
      const alternatives = element(
        'span',
        section.instruments.map((i) => i.text).join('; '),
        'sheet-sr-only',
      );
      alternatives.id = `section-members-${section.nodeId}`;
      button.setAttribute('aria-describedby', alternatives.id);
      item.append(alternatives);
      list.append(item);
    });
    scroll.append(list);
    strip.append(scroll);
    sheet.append(strip);
  }
  const scroll = element('div', '', 'sheet-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Score table, scroll for more settings');
  const table = element('table'),
    caption = element('caption', 'Score sheet');
  table.append(caption);
  const head = element('thead'),
    labels = element('tr');
  ['Instrument', ...model.columns, 'Rewrites · ordered'].forEach((name) => {
    const th = element('th', name);
    th.scope = 'col';
    labels.append(th);
  });
  head.append(labels);
  table.append(head);
  const body = element('tbody');
  model.rows.forEach((row) => {
    const tr = element('tr');
    tr.dataset.nodeId = row.id;
    tr.dataset.muted = String(row.muted);
    tr.classList.toggle('sheet-sit-out', row.absent);
    const name = element('th');
    name.scope = 'row';
    selectable(name, row.id, row.name);
    name.dataset.nodeId = row.id;
    if (options.onMute) {
      const muted = options.definitionMuted?.(row.id) ?? row.muted;
      const mute = element('button', muted ? 'Unmute' : 'Mute', 'sheet-mute');
      mute.type = 'button';
      mute.dataset.muteId = row.id;
      mute.setAttribute(
        'aria-label',
        `${muted ? 'Unmute' : 'Mute'} ${row.name.replaceAll('$', '')}`,
      );
      mute.setAttribute('aria-pressed', String(muted));
      mute.onclick = (event) => {
        event.stopPropagation();
        // Replaced rows may retain queued clicks. A detached row is never current.
        if (host.contains(mute)) options.onMute?.(row.id, !muted);
      };
      mute.onkeydown = (event) => event.stopPropagation();
      name.append(mute);
    }
    name.append(element(row.nameSource === 'generated' ? 'em' : 'strong', row.name));
    if (row.nameSource === 'generated') {
      const alternative = element('span', 'Generated instrument name', 'sheet-sr-only');
      name.append(alternative);
    }
    if (row.muted) name.append(element('small', 'Muted'));
    name.append(element('span', row.status, row.broken !== null ? 'sheet-error' : 'sheet-status'));
    if (!row.sounds.length) name.append(element('small', 'Sound not queried'));
    row.sounds.forEach((sound) =>
      name.append(
        element(
          'span',
          `${sound.name}: ${sound.state === 'not-loaded' ? (model.playing ? 'not used yet' : 'not loaded yet') : sound.state}`,
          `sheet-sound sheet-${sound.state}`,
        ),
      ),
    );
    if (options.onEdit)
      row.useTargets.forEach((note) => {
        const n = element('small', note.text, 'sheet-use-note');
        n.dataset.nodeId = note.nodeId;
        n.setAttribute('role', 'button');
        selectable(n, note.nodeId, note.text);
        name.append(n);
      });
    else row.useNotes.forEach((note) => name.append(element('small', note, 'sheet-use-note')));
    tr.append(name);
    row.cells.forEach((cell) => {
      const td = element('td', '', `sheet-cell sheet-${cell.kind}`);
      td.dataset.nodeId = cell.nodeId;
      td.dataset.control = cell.name;
      if (cell.kind !== 'unused') selectable(td, cell.nodeId, cell.label);
      td.setAttribute('aria-label', cell.summary);
      td.title = cell.summary;
      td.append(element('span', cell.label));
      if (cell.marks.length && cell.kind !== 'constant') td.append(drawing(cell));
      tr.append(td);
    });
    const rewrites = element('td');
    rewrites.dataset.nodeId = row.id;
    const chips = element('ol', '', 'sheet-chips');
    chips.setAttribute('aria-label', `${row.name} rewrites, in order`);
    row.rewrites.forEach((chip, i) => {
      const item = element(
        'li',
        `${i + 1}. ${chip.name}${chip.summary ? ` · ${chip.summary}` : ''}`,
        chip.source ? 'sheet-source' : '',
      );
      item.dataset.nodeId = chip.nodeId;
      item.setAttribute('role', 'button');
      selectable(item, chip.nodeId, chip.summary);
      chips.append(item);
    });
    if (!row.absent)
      rewrites.append(row.rewrites.length ? chips : element('span', 'No rewrites', 'sheet-status'));
    if (options.onEdit && row.rewriteTarget) {
      const add = element('button', '+', 'sheet-add-rewrite');
      add.setAttribute('aria-label', `Add rewrite to ${row.name.replaceAll('$', '')}`);
      add.type = 'button';
      selectable(add, row.rewriteTarget, 'Add rewrite');
      (row.absent ? name : rewrites).append(add);
    }
    tr.append(rewrites);
    body.append(tr);
  });
  table.append(body);
  scroll.append(table);
  sheet.append(scroll);
  host.replaceChildren(sheet);
  setPlayhead(host, model.playheadX);
  host.querySelectorAll<HTMLElement>('.sheet-scroll').forEach((el, i) => {
    el.scrollLeft = scrollers[i]?.left ?? 0;
    el.scrollTop = scrollers[i]?.top ?? 0;
    if (i === scrollFocus) el.focus({ preventScroll: true });
  });
  if (targetFocus)
    Array.from(host.querySelectorAll<HTMLElement>('[data-editor-target]'))
      .find(
        (n) =>
          n.dataset.editorTarget === targetFocus.id &&
          n.dataset.control === targetFocus.control &&
          n.closest<HTMLElement>('tr')?.dataset.nodeId === targetFocus.row,
      )
      ?.focus({ preventScroll: true });
  if (muteFocus)
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-mute-id]'))
      .find((button) => button.dataset.muteId === muteFocus)
      ?.focus({ preventScroll: true });
  if (sectionFocus)
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-section]'))
      .find((button) => button.dataset.section === sectionFocus)
      ?.focus({ preventScroll: true });
}

/** x is a percentage of the displayed cycle window, or null when outside/stopped.
 * Touch only the preallocated playhead paths; preserve table, focus and scroll. */
export function setPlayhead(host: HTMLElement, x: number | null): void {
  const visible = x !== null && Number.isFinite(x) && x >= 0 && x <= 100;
  host.querySelectorAll<SVGPathElement>('.sheet-playhead').forEach((mark) => {
    mark.style.display = visible ? '' : 'none';
    if (visible) mark.setAttribute('d', `M${x},0 V36`);
  });
}

/** Current transport section is separate from the pinned cell selection. */
export function setCurrentSection(host: HTMLElement, cycle: number | null, total: number): void {
  const now = cycle === null || !total ? null : ((cycle % total) + total) % total;
  host.querySelectorAll<HTMLButtonElement>('[data-section]').forEach((button) => {
    const current =
      now !== null && now >= Number(button.dataset.start) && now < Number(button.dataset.end);
    if (current === button.hasAttribute('aria-current')) return;
    button.toggleAttribute('aria-current', current);
    if (current) button.setAttribute('aria-current', 'true');
    button.closest('li')!.classList.toggle('sheet-current', current);
    button.querySelector('.sheet-playing')!.textContent = current ? 'Playing now' : '';
  });
}
