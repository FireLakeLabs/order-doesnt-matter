import type { EditorContext, EditorKind } from '../kind';
import { instruments, walk, type Doc, type Pattern, type Step } from '../../document';
import type { Refusal } from '../../document/edit';
import { isGroup, sequenceOwner } from '../../document/edits/step-shared';
import { layoutRhythm, fractionNumber, type Box } from '../../document/edits/rhythm-layout';
import { setRhythmValue } from '../../document/edits/rhythm-set';
import { restRhythm } from '../../document/edits/rhythm-rest';
import { splitRhythm } from '../../document/edits/rhythm-split';
import { joinRhythm } from '../../document/edits/rhythm-join';
import { speedRhythm } from '../../document/edits/rhythm-speed';
import { rhythmMarks, rhythmNumber, type Mark } from '../../document/edits/rhythm-marks';
import { euclidRhythm, euclidNumbers } from '../../document/edits/rhythm-euclid';
import { mergeRhythm } from '../../document/edits/rhythm-merge';
import { rhythmModifier } from '../../document/edits/rhythm-modifier';
import { insertRhythm } from '../../document/edits/rhythm-insert';
import { removeRhythm } from '../../document/edits/rhythm-remove';
import { moveRhythm } from '../../document/edits/rhythm-move';
import { wrapRhythm } from '../../document/edits/rhythm-wrap';
import { replaceRhythmChunk } from '../../document/edits/rhythm-chunk';
import { printSteps } from '../../import/mini';
import { fieldLabel } from '../presentation';
import './rhythm.css';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
export function rhythmStep(steps: Step[], path: number[]): Step | undefined {
  let step: Step | undefined;
  for (const i of path) {
    step = steps[i];
    steps = step && isGroup(step) ? step.steps : [];
  }
  return step;
}
export function moveSelection(steps: Step[], path: number[], key: string): number[] {
  const step = rhythmStep(steps, path);
  if (!step) return [0];
  if (key === 'ArrowDown' && isGroup(step) && step.steps.length) return [...path, 0];
  if (key === 'ArrowUp' && path.length > 1) return path.slice(0, -1);
  const parent = path.slice(0, -1),
    group = rhythmStep(steps, parent);
  const siblings = parent.length && group && isGroup(group) ? group.steps : steps;
  const index = path.at(-1)! + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0);
  return [...parent, Math.max(0, Math.min(siblings.length - 1, index))];
}
const same = (a: number[], b: number[]) => a.join('.') === b.join('.');
const inside = (a: number[], b: number[]) => b.every((v, i) => a[i] === v);
const span = (boxes: Box[], path: number[]) => {
  const own = boxes.filter((b) => same(b.path, path));
  return own.length
    ? [
        Math.min(...own.map((b) => fractionNumber(b.start))),
        Math.max(...own.map((b) => fractionNumber(b.end))),
      ]
    : [0, 1];
};
/** Choose the shallowest view whose descendants fit the primary pointer. */
export function rhythmZoom(
  steps: Step[],
  selected: number[],
  width: number,
  pointer: 'fine' | 'coarse' = 'coarse',
): number[] {
  const minimum = pointer === 'coarse' ? 44 : 20;
  const boxes = layoutRhythm(steps);
  const fits = (path: number[]) => {
    const [start, end] = span(boxes, path);
    return boxes
      .filter((b) => inside(b.path, path))
      .every((b) => {
        const [a, z] = span(boxes, b.path);
        return ((z - a) / (end - start)) * width + 1e-9 >= minimum;
      });
  };
  if (fits([])) return [];
  for (let depth = 1; depth <= selected.length; depth++) {
    const path = selected.slice(0, depth);
    if (fits(path)) return path;
  }
  const path = [...selected];
  let s = rhythmStep(steps, path);
  while (s && isGroup(s) && s.steps.length && !fits(path)) {
    path.push(0);
    s = s.steps[0];
  }
  return path;
}
/** A one-cycle note strip follows the editable region; longer windows stay labelled in full. */
export function rhythmStripWindow(window: EditorContext['window'], region: number[]) {
  const { fromCycle: from, toCycle: to } = window;
  return to - from === 1 ? { fromCycle: from + region[0], toCycle: from + region[1] } : window;
}
const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;
const partName = (path: number[]) => path.map((n) => `${ordinal(n + 1)} part`).join(' › ');
const description = (s: Step): string => {
  const name =
    s.kind === 'value'
      ? s.value
      : s.kind === 'rest'
        ? 'rest'
        : s.kind === 'sub'
          ? `split in ${s.steps.length}`
          : s.kind === 'alternate'
            ? 'takes turns, one per cycle'
            : s.kind === 'together'
              ? 'at the same time'
              : s.kind === 'euclid' && euclidNumbers(s)
                ? `${euclidNumbers(s)!.hits} hits out of ${euclidNumbers(s)!.outOf}`
                : s.kind === 'other' && rhythmMarks(s)
                  ? `${description(rhythmMarks(s)!.base)} · ${rhythmMarks(s)!
                      .ops.map(
                        (op) =>
                          `${{ repeat: 'repeat ×', faster: 'faster ×', slower: 'slower ÷', weight: 'length ' }[op.name]}${op.name === 'weight' ? rhythmMarks(s)!.weight : op.amount}`,
                      )
                      .join(' · ')}`
                  : 'source chunk';
  const weight = 'weight' in s ? s.weight : undefined;
  return [
    name,
    weight && weight !== 1 ? `${weight} parts long` : '',
    s.kind === 'value' && s.repeat ? `${s.repeat} repeats` : '',
  ]
    .filter(Boolean)
    .join(' · ');
};
export default {
  id: 'rhythm',
  layout: 'wide',
  priority: 10,
  matches: (target) => target.kind === 'rhythm',
  mount(body, initial) {
    let context = initial,
      selected = [0],
      rendered = '',
      view = sessionStorage.getItem('odm-rhythm-view') ?? '',
      region = [0, 1],
      marksOpen = false;
    const root = el('div'),
      strip = el('figure'),
      controls = el('div'),
      structure = el('div'),
      actions = el('div'),
      error = el('p');
    root.className = 'rhythm-editor';
    controls.className = 'editor-actions';
    actions.className = 'rhythm-actions';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Rhythm view');
    error.setAttribute('role', 'alert');
    error.className = 'editor-error';
    root.append(controls, structure, actions, error);
    body.append(root);
    const pointer = matchMedia('(pointer: coarse)');
    const steps = () => {
      const c = sequenceOwner(context.doc, context.target.nodeId)?.core;
      return c?.kind === 'sequence' ? c.steps : [];
    };
    const drawing = () => {
      const cycle = Math.floor(context.window.fromCycle);
      return layoutRhythm(steps(), cycle).map((box) => ({
        ...box,
        start: [box.start[0] - cycle * box.start[1], box.start[1]] as [number, number],
        end: [box.end[0] - cycle * box.end[1], box.end[1]] as [number, number],
      }));
    };
    const button = (
      parent: HTMLElement,
      text: string,
      key: string,
      action: () => void,
      disabled = false,
    ) => {
      const b = el('button', text);
      b.type = 'button';
      b.dataset.rhythmKey = key;
      b.disabled = disabled;
      b.onclick = action;
      parent.append(b);
      return b;
    };
    function edit(operation: (d: Doc, id: string, path: number[]) => Doc | Refusal) {
      const result = operation(context.doc, context.target.nodeId, selected);
      error.textContent = 'ok' in result ? result.reason : '';
      if (!('ok' in result)) context.apply(result);
    }
    function select(path: number[], focus = false) {
      selected = path;
      rendered = '';
      render();
      if (focus)
        structure
          .querySelector<HTMLElement>(`[data-path="${selected.join('.')}"]`)
          ?.focus({ preventScroll: true });
    }
    function notePicker(parent: HTMLElement, s: Step) {
      const control = sequenceOwner(context.doc, context.target.nodeId)?.control,
        sound = control === 's' || control === 'sound';
      const input = el('input'),
        options = el('datalist');
      input.value = s.kind === 'value' ? s.value : sound ? 'bd' : 'c4';
      input.setAttribute('aria-label', sound ? 'Sound value' : 'Note value');
      input.dataset.rhythmKey = 'value';
      options.id = `rhythm-picker-${context.target.nodeId.replace(/\W/g, '-')}`;
      input.setAttribute('list', options.id);
      const values = new Set<string>();
      if (sound)
        walk(context.doc, (node) => {
          if (!('core' in node)) return;
          const p = node as Pattern;
          if (p.core.kind === 'generator' && ['s', 'sound'].includes(p.core.name)) {
            const c = sequenceOwner(context.doc, `${p.id}:rhythm`)?.core;
            if (c?.kind === 'sequence')
              layoutRhythm(c.steps).forEach((b) => {
                if (b.value) values.add(b.value);
              });
          }
        });
      else
        (control === 'n'
          ? ['0', '1', '2', '3', '4', '5', '6', '7']
          : control === 'freq'
            ? ['110', '220', '440', '880']
            : ['c2', 'd2', 'e2', 'f2', 'g2', 'a2', 'b2', 'c3', 'c4', 'd4', 'e4', 'g4']
        ).forEach((n) => values.add(n));
      context.instrument?.sounds.forEach((n) => {
        if (sound) values.add(n.name);
      });
      values.forEach((v) => options.append(el('option', v)));
      const change = () => edit((d, id, p) => setRhythmValue(d, id, p, input.value));
      input.onchange = change;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          change();
        }
      };
      parent.append(fieldLabel(sound ? 'Sound' : 'Note', input), options);
    }
    function render() {
      const list = steps();
      while (selected.length > 1 && !rhythmStep(list, selected)) selected = selected.slice(0, -1);
      if (!rhythmStep(list, selected)) selected = [0];
      const width = structure.clientWidth || root.clientWidth;
      const unresolved = drawing().some((b) => !b.path.length);
      if (unresolved) view = 'List';
      if (!view) view = innerWidth < 900 ? 'List' : 'Boxes';
      const key = JSON.stringify([
        list,
        selected,
        view,
        Math.floor(width),
        pointer.matches,
        context.window.fromCycle,
      ]);
      if (key === rendered) return;
      rendered = key;
      const focus = (document.activeElement as HTMLElement)?.dataset.rhythmKey;
      controls.replaceChildren();
      for (const label of ['Boxes', 'List']) {
        const b = button(controls, label, label, () => {
          view = label;
          sessionStorage.setItem('odm-rhythm-view', label);
          render();
        });
        b.disabled = unresolved && label === 'Boxes';
        if (b.disabled)
          b.title =
            'Timing for this source is shown in the real notes strip. Use List to edit its parts.';
        b.setAttribute('aria-pressed', String(view === label));
      }
      structure.replaceChildren();
      actions.replaceChildren();
      structure.dataset.view = view;
      const helper = el('p', 'Edit this rhythm. Arrows move; down enters a group, up leaves it.');
      helper.className = 'sheet-sr-only';
      controls.append(helper);
      if (!list.length) {
        structure.append(el('p', 'This sequence is available through Edit as source.'));
        return;
      }
      const boxes = drawing(),
        zoom =
          view === 'Boxes'
            ? rhythmZoom(list, selected, width, pointer.matches ? 'coarse' : 'fine')
            : [];
      region = span(boxes, zoom);
      if (zoom.length > selected.length) selected = zoom;
      if (zoom.length) {
        const overview = el('figure');
        overview.className = 'rhythm-overview';
        overview.append(el('figcaption', 'Whole cycle · highlighted part below'));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 1000 40');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Whole cycle with the zoomed region highlighted');
        for (const box of boxes) {
          const rect = document.createElementNS(svg.namespaceURI, 'rect');
          rect.setAttribute('x', String(fractionNumber(box.start) * 1000));
          rect.setAttribute(
            'width',
            String((fractionNumber(box.end) - fractionNumber(box.start)) * 1000),
          );
          rect.setAttribute('y', String(4 + box.depth * 8));
          rect.setAttribute('height', '6');
          rect.setAttribute('class', box.kind === 'rest' ? 'overview-rest' : 'overview-part');
          svg.append(rect);
        }
        const [a, z] = span(boxes, zoom);
        const highlight = document.createElementNS(svg.namespaceURI, 'rect');
        highlight.setAttribute('x', String(a * 1000));
        highlight.setAttribute('width', String((z - a) * 1000));
        highlight.setAttribute('y', '1');
        highlight.setAttribute('height', '38');
        highlight.setAttribute('class', 'overview-window');
        svg.append(highlight);
        overview.append(svg);
        structure.append(overview);
        const navigation = el('div');
        navigation.className = 'rhythm-zoom-navigation';
        navigation.append(el('span', partName(zoom)));
        button(navigation, 'Back to whole cycle', 'back', () => {
          view = 'List';
          sessionStorage.setItem('odm-rhythm-view', view);
          render();
        });
        structure.append(navigation);
      }
      const tree = el('div');
      tree.className = view === 'Boxes' ? 'rhythm-boxes' : 'rhythm-list';
      tree.setAttribute('aria-label', 'Rhythm parts');
      structure.append(strip, tree);
      drawStrip();
      function part(s: Step, path: number[], parent: HTMLElement, parentSpan: number) {
        const item = el('div'),
          [a, z] = span(boxes, path);
        item.className = `rhythm-part rhythm-${s.kind}`;
        if (view === 'Boxes') item.style.width = `${((z - a) / parentSpan) * 100}%`;
        else item.style.setProperty('--depth', String(path.length - 1));
        parent.append(item);
        const b = button(
          item,
          view === 'List' ? `${partName(path)} · ${description(s)}` : description(s),
          `part-${path.join('.')}`,
          () => select(path),
        );
        b.title = `${partName(path)}: ${description(s)}`;
        b.dataset.path = path.join('.');
        b.setAttribute('aria-label', `${partName(path)}: ${description(s)}`);
        b.setAttribute('aria-pressed', String(same(selected, path)));
        b.tabIndex = same(selected, path) ? 0 : -1;
        b.onkeydown = (e) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
            e.preventDefault();
            select(moveSelection(list, path, e.key), true);
          }
        };
        const pulses = boxes.find((box) => same(box.path, path))?.pulses;
        if (pulses) {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 1000 24');
          svg.setAttribute('preserveAspectRatio', 'none');
          svg.setAttribute('role', 'img');
          svg.setAttribute('aria-label', 'Hits and gaps at their real positions');
          for (const pulse of pulses) {
            const rect = document.createElementNS(svg.namespaceURI, 'rect');
            rect.setAttribute('x', String(pulse.from * 1000));
            rect.setAttribute('width', String((pulse.to - pulse.from) * 1000));
            rect.setAttribute('y', '2');
            rect.setAttribute('height', '20');
            rect.setAttribute(
              'class',
              pulse.value === undefined ? 'overview-rest' : 'overview-part',
            );
            svg.append(rect);
          }
          item.append(svg);
        }
        if (isGroup(s)) {
          const children = el('div');
          children.className = s.kind === 'sub' ? 'rhythm-row' : 'rhythm-stack';
          item.append(children);
          s.steps.forEach((child, i) => {
            if (s.kind === 'alternate') {
              const row = el('div');
              const turn = el('small', `turn ${i + 1}`);
              turn.title = `turn ${i + 1}`;
              row.append(turn);
              children.append(row);
              part(child, [...path, i], row, z - a);
            } else part(child, [...path, i], children, z - a);
          });
        }
      }
      if (zoom.length) {
        const s = rhythmStep(list, zoom)!;
        const [a, z] = span(boxes, zoom);
        part(s, zoom, tree, z - a);
      } else list.forEach((s, i) => part(s, [i], tree, 1));
      const s = rhythmStep(list, selected)!;
      actions.append(el('h3', `Selected · ${partName(selected)}`));
      const numeric = (
        parent: HTMLElement,
        label: string,
        value: number,
        change: (n: number) => void,
        whole = false,
      ) => {
        const input = el('input');
        input.type = 'text';
        input.inputMode = whole ? 'numeric' : 'decimal';
        input.value = String(value);
        input.setAttribute('aria-label', label);
        input.dataset.rhythmKey = label;
        const apply = () => change(rhythmNumber(input.value));
        input.onchange = apply;
        input.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            change(rhythmNumber(input.value) + (e.key === 'ArrowUp' ? 1 : -1));
          }
        };
        parent.append(fieldLabel(label, input));
        button(parent, '−', `${label}-less`, () => change(value - 1)).setAttribute(
          'aria-label',
          `Decrease ${label}`,
        );
        button(parent, '+', `${label}-more`, () => change(value + 1)).setAttribute(
          'aria-label',
          `Increase ${label}`,
        );
      };
      const marks = rhythmMarks(s);
      if (marks) {
        const details = el('details');
        details.className = 'rhythm-marks';
        details.open = marksOpen || marks.ops.length > 0;
        details.ontoggle = () => {
          marksOpen = details.open;
        };
        details.append(el('summary', 'Speed and length'));
        for (const [name, label] of [
          ['repeat', 'Repeat ×n'],
          ['faster', 'Faster ×n'],
          ['slower', 'Slower ÷n'],
          ['weight', 'Length n parts'],
        ] as [Mark, string][]) {
          const group = el('div');
          group.className = 'rhythm-action-group';
          const current =
            name === 'weight'
              ? marks.weight
              : (marks.ops.find((op) => op.name === name)?.amount ?? 1);
          numeric(
            group,
            label,
            current,
            (n) => edit((d, id, p) => speedRhythm(d, id, p, name, n)),
            name === 'repeat',
          );
          button(group, 'None', `none-${name}`, () =>
            edit((d, id, p) => speedRhythm(d, id, p, name, null)),
          ).setAttribute('aria-label', `None for ${label}`);
          details.append(group);
        }
        actions.append(details);
      }
      const euclid = euclidNumbers(marks?.base ?? s);
      if (euclid) {
        const group = el('div');
        group.className = 'rhythm-action-group';
        for (const [key, label] of [
          ['hits', 'hits'],
          ['outOf', 'out of'],
          ['turn', 'turn by'],
        ] as const)
          numeric(
            group,
            label,
            euclid[key],
            (n) => {
              const next = { ...euclid, [key]: n };
              edit((d, id, p) => euclidRhythm(d, id, p, next.hits, next.outOf, next.turn));
            },
            true,
          );
        button(group, 'Back to plain step', 'euclid-none', () =>
          edit((d, id, p) => euclidRhythm(d, id, p, null)),
        );
        actions.insertBefore(group, actions.querySelector('.rhythm-marks'));
      } else if (marks?.base.kind === 'value' && Object.keys(marks.base).length === 2) {
        button(actions, 'Spread hits evenly…', 'euclid', () =>
          edit((d, id, p) => euclidRhythm(d, id, p, 3)),
        );
      }
      if (!isGroup(s) && !['value', 'rest'].includes(s.kind)) {
        if (marks || euclid) {
          if (focus)
            Array.from(root.querySelectorAll<HTMLElement>('[data-rhythm-key]'))
              .find((n) => n.dataset.rhythmKey === focus)
              ?.focus({ preventScroll: true });
        }
        const details = el('details'),
          text = el('textarea');
        details.append(el('summary', 'Edit chunk as source'));
        text.value = printSteps([s]);
        text.setAttribute('aria-label', 'Chunk text');
        details.append(text);
        button(details, 'Save chunk', 'chunk', () =>
          edit((d, id, p) => replaceRhythmChunk(d, id, p, text.value)),
        );
        actions.append(details);
        return;
      }
      let buttons!: HTMLElement;
      const actionGroup = (name: string) => {
        buttons = el('div');
        buttons.className = 'rhythm-action-group';
        buttons.setAttribute('role', 'group');
        buttons.setAttribute('aria-label', name);
        actions.append(buttons);
        return buttons;
      };
      if (s.kind === 'value') notePicker(actionGroup('Value'), s);
      actionGroup('Rest');
      const add = (
        text: string,
        op: (d: Doc, id: string, p: number[]) => Doc | Refusal,
        disabled = false,
      ) => button(buttons, text, text, () => edit(op), disabled);
      add(s.kind === 'rest' ? 'Bring back' : 'Rest', restRhythm);
      actionGroup('Split');
      for (const n of [2, 3]) add(`Split in ${n}`, (d, id, p) => splitRhythm(d, id, p, n));
      const more = el('select');
      more.setAttribute('aria-label', 'Split into more parts');
      more.append(el('option', 'Split in more…'));
      for (let n = 4; n <= 8; n++) {
        const option = el('option', `Split in ${n}`);
        option.value = String(n);
        more.append(option);
      }
      more.onchange = () => edit((d, id, p) => splitRhythm(d, id, p, Number(more.value)));
      buttons.append(more);
      if (isGroup(s)) {
        add('Join back', joinRhythm);
        add('Merge', mergeRhythm);
        const confirmation = el('details');
        confirmation.append(el('summary', 'Merge nested parts…'));
        button(confirmation, 'Confirm discarding nested parts', 'confirm-merge', () =>
          edit((d, id, p) => mergeRhythm(d, id, p, true)),
        );
        actions.append(confirmation);
      }
      actionGroup('Length');
      const length =
        ('weight' in s ? s.weight : undefined) ?? (s.kind === 'value' ? s.repeat : undefined) ?? 1;
      if (['value', 'rest', 'sub'].includes(s.kind)) {
        add('Longer', (d, id, p) => rhythmModifier(d, id, p, 'weight', Math.floor(length) + 1));
        add(
          'Shorter',
          (d, id, p) => rhythmModifier(d, id, p, 'weight', Math.max(1, Math.ceil(length) - 1)),
          length <= 1,
        );
      }
      const defaultValue =
        s.kind === 'value'
          ? s.value
          : sequenceOwner(context.doc, context.target.nodeId)?.control === 's'
            ? 'bd'
            : '60';
      actionGroup('Add a part');
      for (const [text, offset] of [
        ['Add before', 0],
        ['Add after', 1],
      ] as const)
        add(text, (d, id, p) =>
          insertRhythm(d, id, p.slice(0, -1), p.at(-1)! + offset, defaultValue),
        );
      actionGroup('Alternatives');
      add('Take turns', (d, id, p) => wrapRhythm(d, id, p, 'alternate', defaultValue));
      actionGroup('Simultaneous notes');
      add('Add note at the same time', (d, id, p) =>
        wrapRhythm(d, id, p, 'together', defaultValue),
      );
      const parent = selected.slice(0, -1),
        group = rhythmStep(list, parent),
        siblings = parent.length && group && isGroup(group) ? group.steps : list,
        index = selected.at(-1)!;
      actionGroup('Move');
      add('Earlier', (d, id, p) => moveRhythm(d, id, p, index - 1), index === 0);
      add('Later', (d, id, p) => moveRhythm(d, id, p, index + 1), index === siblings.length - 1);
      actionGroup('Remove');
      add('Remove', removeRhythm);
      if (focus)
        Array.from(root.querySelectorAll<HTMLElement>('[data-rhythm-key]'))
          .find((n) => n.dataset.rhythmKey === focus)
          ?.focus({ preventScroll: true });
    }
    function drawStrip() {
      const row = instruments(context.doc).find((r) => r.id === context.target.instrumentId);
      const rewrites =
        row &&
        [...row.pattern.layers, ...row.uses.flatMap((u) => u.layers)].some(
          (l) => l.kind === 'rewrite',
        );
      const { fromCycle: from, toCycle: to } = rhythmStripWindow(context.window, region);
      const caption = el(
        'figcaption',
        `Real note starts${rewrites ? ' · after rewrites' : ''} · cycles ${from}–${to}`,
      );
      strip.replaceChildren(caption);
      if (!context.events || context.events.error) {
        strip.append(
          el(
            'p',
            context.events?.error ? `Broken: ${context.events.error.message}` : 'Loading notes…',
          ),
        );
        return;
      }
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 1000 45');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Notes at their real spans');
      const notes = context.events.events.filter(
        (e) => e.whole && e.part[0] === e.whole[0] && e.whole[0] >= from && e.whole[0] < to,
      );
      notes.slice(0, 500).forEach((e, i) => {
        const [a, z] = e.whole!,
          rect = document.createElementNS(svg.namespaceURI, 'rect'),
          title = document.createElementNS(svg.namespaceURI, 'title');
        rect.setAttribute('x', String(((Math.max(from, a) - from) / (to - from)) * 1000));
        rect.setAttribute(
          'width',
          String(((Math.min(to, z) - Math.max(from, a)) / (to - from)) * 1000),
        );
        rect.setAttribute('y', String(3 + (i % 4) * 10));
        rect.setAttribute('height', '7');
        title.textContent = JSON.stringify(e.value);
        rect.append(title);
        svg.append(rect);
      });
      strip.append(svg);
      if (!notes.length) strip.append(el('small', 'No note starts in this window'));
      if (notes.length > 500) strip.append(el('small', 'First 500 note starts shown'));
    }
    const observer = new ResizeObserver(() => render());
    observer.observe(root);
    pointer.addEventListener('change', render);
    function update(next: EditorContext) {
      context = next;
      render();
      drawStrip();
    }
    update(initial);
    return {
      update,
      destroy() {
        observer.disconnect();
        pointer.removeEventListener('change', render);
        root.remove();
      },
    };
  },
} satisfies EditorKind;
