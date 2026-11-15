import type { Doc, MiniMark, Step } from '../../../document';
import type { Refusal } from '../../../document/edit';
import type { EditorContext } from '../../kind';
import {
  miniStepAt,
  sequenceOwner,
  stepChildren,
  type MiniPath,
} from '../../../document/edits/step-shared';
import { replaceMiniStep } from '../../../document/edits/mini-replace';
import { spliceMiniSteps } from '../../../document/edits/mini-splice';
import { setMiniMark } from '../../../document/edits/mini-mark';
import { printSteps } from '../../../import/mini';
import { numericMini } from '../../../document/edits/mini-shared';
import { rhythmMarks } from '../../../document/edits/rhythm-marks';
import { fieldLabel } from '../../presentation';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
const key = (p: MiniPath) => JSON.stringify(p);
export const structuralMini = (s: Step): boolean =>
  (s.kind === 'polymeter' &&
    (!s.per ||
      (s.per.kind === 'value' &&
        Object.keys(s.per).length === 2 &&
        !!numericMini(s.per, 1 / 1024, 1024)))) ||
  s.kind === 'choose' ||
  (s.kind === 'other' && !!s.expression && !rhythmMarks(s)) ||
  (s.kind === 'euclid' &&
    stepChildren(s).some((c) => c.role !== 'subject' && c.step.kind !== 'value'));
const names = {
  subject: 'Subject',
  hits: 'Hits',
  steps: 'Out of',
  rotation: 'Rotation',
  faster: 'Faster ×',
  slower: 'Slower ÷',
  candidate: 'Candidate',
  lane: 'Lane',
  part: 'Part',
  per: 'Per cycle',
};
const markNames = {
  faster: 'Faster ×',
  slower: 'Slower ÷',
  repeat: 'Repeat !',
  weight: 'Length @',
  chance: 'Leave out ?',
};

/** A structural List inside the existing editor; addresses are serialized paths.
 * It supplies no geometry. The containing editor keeps its queried event strip. */
export function miniStructure(context: () => EditorContext, base: MiniPath) {
  const root = el('div');
  root.className = 'mini-structure';
  let selected = base,
    signature = '';
  function revealSelection() {
    const tree = root.querySelector<HTMLElement>('.mini-tree');
    const selectedButton = Array.from(root.querySelectorAll<HTMLElement>('[data-mini-key]')).find(
      (n) => n.dataset.miniKey === key(selected),
    );
    if (tree && selectedButton) {
      const bounds = tree.getBoundingClientRect(),
        item = selectedButton.getBoundingClientRect();
      tree.scrollTop +=
        Math.min(0, item.top - bounds.top) + Math.max(0, item.bottom - bounds.bottom);
    }
  }
  function update() {
    const ctx = context(),
      core = sequenceOwner(ctx.doc, ctx.target.nodeId)?.core;
    if (core?.kind !== 'sequence') return;
    const top = miniStepAt(core.steps, base);
    if (!top) return;
    const nodes: { path: MiniPath; label: string; step: Step; parent?: MiniPath }[] = [];
    function collect(s: Step, p: MiniPath, label: string, parent?: MiniPath) {
      nodes.push({ path: p, label, step: s, parent });
      stepChildren(s).forEach((child) =>
        collect(
          child.step,
          [...p, ...child.path],
          `${label} › ${names[child.role]}${['part', 'lane', 'candidate', 'faster', 'slower'].includes(child.role) ? ` ${Number(child.role === 'faster' || child.role === 'slower' ? child.path[2] : child.path.at(-1)) + 1}` : ''}`,
          p,
        ),
      );
    }
    collect(
      top,
      base,
      base
        .filter((n) => typeof n === 'number')
        .map((n) => `Part ${Number(n) + 1}`)
        .join(' › '),
    );
    if (!nodes.some((n) => key(n.path) === key(selected))) selected = base;
    const next = JSON.stringify([top, selected]);
    if (signature === next) {
      revealSelection();
      return;
    }
    signature = next;
    const focus = root.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.miniKey
      : undefined;
    const treeScroll = root.querySelector('.mini-tree')?.scrollTop ?? 0;
    const opened = new Set(
      Array.from(root.querySelectorAll<HTMLDetailsElement>('details[open]')).map(
        (n) => n.dataset.miniKey,
      ),
    );
    root.replaceChildren();
    const tree = el('div'),
      actions = el('div'),
      error = el('p');
    tree.className = 'mini-tree';
    actions.className = 'mini-actions';
    error.setAttribute('role', 'alert');
    root.append(
      el(
        'p',
        'Parts · note timing is shown in the strip. Arrows move; down enters a group, up leaves.',
      ),
      tree,
      actions,
      error,
    );
    function apply(operation: (d: Doc, id: string) => Doc | Refusal) {
      const c = context(),
        result = operation(c.doc, c.target.nodeId);
      error.textContent = 'ok' in result ? result.reason : '';
      if (!('ok' in result) && result !== c.doc) c.apply(result);
    }
    function button(
      parent: HTMLElement,
      label: string,
      id: string,
      action: () => void,
      disabled = false,
    ) {
      const b = el('button', label);
      b.type = 'button';
      b.dataset.miniKey = id;
      b.onclick = action;
      b.disabled = disabled;
      parent.append(b);
      return b;
    }
    function select(p: MiniPath) {
      selected = p;
      update();
      root
        .querySelector<HTMLElement>(`[data-mini-key='${key(p)}']`)
        ?.focus({ preventScroll: true });
      root
        .querySelector<HTMLElement>(`[data-mini-key='${key(p)}']`)
        ?.scrollIntoView({ block: 'nearest' });
    }
    function field(parent: HTMLElement, label: string, value: string, change: (s: string) => void) {
      const input = el('input');
      input.value = value;
      input.setAttribute('aria-label', label);
      input.dataset.miniKey = `${key(selected)}:${label}`;
      let submitted = value;
      const submit = () => {
        if (input.value === submitted) return;
        submitted = input.value;
        change(submitted);
      };
      input.onchange = submit;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      };
      parent.append(fieldLabel(label, input));
    }
    for (const n of nodes) {
      const b = button(tree, `${n.label}: ${printSteps([n.step])}`, key(n.path), () =>
        select(n.path),
      );
      b.style.setProperty(
        '--mini-depth',
        String(
          nodes.filter(
            (a) => a.path.length < n.path.length && a.path.every((v, i) => n.path[i] === v),
          ).length,
        ),
      );
      b.setAttribute('aria-pressed', String(key(n.path) === key(selected)));
      b.tabIndex = key(n.path) === key(selected) ? 0 : -1;
      b.onkeydown = (e) => {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.preventDefault();
        const siblings = nodes.filter((a) => key(a.parent ?? []) === key(n.parent ?? []));
        const index = siblings.indexOf(n),
          delta = e.key === 'ArrowLeft' ? -1 : 1;
        select(
          e.key === 'ArrowUp'
            ? (n.parent ?? base)
            : e.key === 'ArrowDown'
              ? (nodes.find((a) => key(a.parent ?? []) === key(n.path))?.path ?? n.path)
              : siblings[Math.max(0, Math.min(siblings.length - 1, index + delta))].path,
        );
      };
    }
    tree.scrollTop = treeScroll;
    revealSelection();
    const own = nodes.find((n) => key(n.path) === key(selected))!,
      s = own.step;
    actions.append(el('h3', `Selected · ${own.label}`));
    const replace = (text: string) => apply((d, id) => replaceMiniStep(d, id, selected, text));
    if (s.kind === 'value' || s.kind === 'rest')
      field(actions, `${own.label} value`, printSteps([s]), replace);
    if (s.kind === 'choose')
      actions.append(
        el(
          'p',
          'Candidates are chosen deterministically by absolute time. No candidate has a fixed time slot.',
        ),
      );
    if (s.kind === 'polymeter') {
      actions.append(
        el(
          'p',
          'Lanes retain their own part counts. Per cycle is an explicit constant; patterned per-cycle values stay text.',
        ),
      );
      if (!s.per)
        button(actions, 'Set explicit per cycle', 'per', () =>
          replace(printSteps([{ ...s, per: { kind: 'value', value: '4' } }])),
        );
    }
    if (s.kind === 'euclid') {
      actions.append(
        el(
          'p',
          'Hits, out of and rotation can each change over time. Negative hits leave positions empty before rotation.',
        ),
      );
      if (!s.rotation)
        button(actions, 'Add rotation', 'rotation', () =>
          replace(printSteps([{ ...s, rotation: { kind: 'value', value: '0' } }])),
        );
    }
    // Numeric argument modes replace exactly the selected subtree. The operation
    // validates its numeric parent, including safe bounds and signed hit limits.
    const numericRole = nodes.some((n) =>
      stepChildren(n.step).some(
        (c) =>
          ['hits', 'steps', 'rotation', 'faster', 'slower', 'per'].includes(c.role) &&
          key([...n.path, ...c.path]) === key(selected),
      ),
    );
    if (numericRole) {
      const constant = String(numericMini(s, -1024, 1024)?.[0] ?? 1);
      button(actions, 'Use constant', 'constant', () => replace(constant));
      if (own.label.endsWith('Per cycle') === false)
        button(actions, 'Use pattern', 'pattern', () => replace(`<${constant} ${constant}>`));
    }
    if ('steps' in s && s.kind !== 'euclid') {
      const listPath = [...selected, 'steps'];
      const role = s.kind === 'choose' ? 'candidate' : s.kind === 'polymeter' ? 'lane' : 'part';
      button(actions, `Add ${role}`, 'add', () =>
        apply((d, id) =>
          spliceMiniSteps(
            d,
            id,
            listPath,
            s.steps.length,
            0,
            s.kind === 'polymeter' ? '[~]' : s.kind === 'choose' ? '~' : '1',
          ),
        ),
      );
      s.steps.forEach((_, i) =>
        button(
          actions,
          `Remove ${role} ${i + 1}`,
          `remove-${i}`,
          () => apply((d, id) => spliceMiniSteps(d, id, listPath, i, 1)),
          s.steps.length <= (s.kind === 'choose' ? 2 : 1),
        ),
      );
    }
    if (s.kind === 'other' && s.expression) {
      actions.append(el('p', 'Outer marks · written order, including repeated occurrences.'));
      s.expression.marks.forEach((m, i) => {
        const row = el('div');
        row.className = 'mini-mark';
        actions.append(row);
        if (typeof m.amount === 'object')
          row.append(
            el('p', `Mark ${i + 1} · ${markNames[m.name]} · select its rate in the list above`),
          );
        else
          field(
            row,
            `Mark ${i + 1} ${markNames[m.name]}`,
            String(m.amount ?? (m.name === 'chance' ? 0.5 : 2)),
            (text) => {
              if (!text.trim() || !Number.isFinite(Number(text))) {
                error.textContent = 'Enter a finite number; previous values kept';
                return;
              }
              apply((d, id) =>
                setMiniMark(d, id, selected, i, { ...m, amount: Number(text) } as MiniMark),
              );
            },
          );
        button(row, `Remove mark ${i + 1}`, `mark-${i}`, () =>
          apply((d, id) => setMiniMark(d, id, selected, i, null)),
        );
      });
      const type = el('select');
      type.setAttribute('aria-label', 'New outer mark');
      Object.entries(markNames).forEach(([name, label]) => {
        const o = el('option', label);
        o.value = name;
        type.append(o);
      });
      actions.append(type);
      button(actions, 'Append mark', 'append', () => {
        const name = type.value as MiniMark['name'];
        const mark: MiniMark =
          name === 'faster' || name === 'slower'
            ? { name, amount: { kind: 'value', value: '1' } }
            : { name, amount: name === 'chance' ? 0.5 : 2 };
        apply((d, id) => setMiniMark(d, id, selected, s.expression!.marks.length, mark));
      });
    }
    const source = el('details'),
      text = el('textarea');
    source.dataset.miniKey = `${key(selected)}:source`;
    source.open = opened.has(source.dataset.miniKey);
    source.append(el('summary', 'Edit selected part as text'));
    text.dataset.miniKey = `${key(selected)}:text`;
    text.value = printSteps([s]);
    text.setAttribute('aria-label', `${own.label} mini source`);
    source.append(text);
    button(source, 'Save mini text', 'save-source', () => replace(text.value));
    source.append(
      el(
        'p',
        'Supported mini text is validated here. Legacy or unproven forms remain available through the editor’s Edit as source.',
      ),
    );
    actions.append(source);
    if (focus) {
      const controls = Array.from(root.querySelectorAll<HTMLElement>('[data-mini-key]'));
      (
        controls.find((n) => n.dataset.miniKey === focus) ??
        controls.find((n) => n.dataset.miniKey === key(selected))
      )?.focus({ preventScroll: true });
    }
  }
  return { root, update };
}
