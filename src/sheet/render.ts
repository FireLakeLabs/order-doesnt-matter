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
function drawing(cell: Cell, playheadX: number | null) {
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
  if (playheadX !== null)
    svg.append(svgElement('path', { d: `M${playheadX},0 V36`, class: 'sheet-playhead' }));
  return svg;
}

/** Rendering only: the model owns values, ordering, descriptions and geometry. */
export function mountSheet(host: HTMLElement, model: SheetModel): void {
  const sheet = element('section', '', 'odm-sheet');
  sheet.setAttribute('aria-label', 'Score sheet');
  const heading = element('header');
  heading.append(
    element('p', 'ORDER DOESN’T MATTER', 'sheet-eyebrow'),
    element('h1', 'One piece. All its settings.'),
    element('p', model.caption),
    element(
      'p',
      'Settings are an unordered set. Rewrites run in numbered order. Scroll the table for more settings.',
    ),
  );
  sheet.append(heading);
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
      if (section.current) item.setAttribute('aria-current', 'true');
      item.append(
        element('strong', section.name),
        element(
          'span',
          `${section.cycles} cycles · ${section.start}–${section.start + section.cycles}`,
        ),
      );
      section.instruments.forEach((instrument) =>
        item.append(element('small', instrument.text, `sheet-${instrument.state}`)),
      );
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
    const name = element('th');
    name.scope = 'row';
    name.dataset.nodeId = row.id;
    name.append(
      element('strong', row.name),
      element(
        'small',
        `${row.nameSource === 'generated' ? 'Generated name' : 'Author name'}${row.muted ? ' · Muted' : ''}`,
      ),
      element('span', row.status, row.broken !== null ? 'sheet-error' : 'sheet-status'),
    );
    if (!row.sounds.length) name.append(element('small', 'Sound not queried'));
    row.sounds.forEach((sound) =>
      name.append(
        element(
          'span',
          `${sound.name}: ${sound.state}${sound.detail ? ` — ${sound.detail}` : ''}`,
          `sheet-sound sheet-${sound.state}`,
        ),
      ),
    );
    tr.append(name);
    row.cells.forEach((cell) => {
      const td = element('td', '', `sheet-cell sheet-${cell.kind}`);
      td.dataset.nodeId = cell.nodeId;
      td.setAttribute('aria-label', cell.summary);
      td.title = cell.summary;
      td.append(element('span', cell.label));
      if (cell.marks.length) td.append(drawing(cell, model.playheadX));
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
      chips.append(item);
    });
    rewrites.append(row.rewrites.length ? chips : element('span', 'No rewrites', 'sheet-status'));
    tr.append(rewrites);
    body.append(tr);
  });
  table.append(body);
  scroll.append(table);
  sheet.append(scroll);
  host.replaceChildren(sheet);
}
