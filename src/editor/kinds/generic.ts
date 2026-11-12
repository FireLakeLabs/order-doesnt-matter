import type { EditorKind } from '../kind';
import { callAt, argumentSource } from '../../document/edits/source-shared';
import { rewriteOwner } from '../../document/edits/rewrite-shared';
import { setGenericArgument } from '../../document/edits/generic-argument';
import type { Arg } from '../../document';
import { describeTarget } from '../../document/edit';
import { fieldLabel } from '../presentation';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
// These calls already have a purpose-built rewrite editor.
const purposeBuilt = new Set(
  'fast slow early late rev palindrome ply euclid euclidRot degradeBy sometimes sometimesBy often rarely every firstOf off jux segment'.split(
    ' ',
  ),
);
export default {
  id: 'generic',
  priority: 20,
  matches: (t) =>
    // `piece:` addresses are actions with their own editor (add or make sections), not calls.
    (t.kind === 'unknown' && !t.nodeId.startsWith('piece:')) ||
    (t.kind === 'rewrite' &&
      !!t.node &&
      'name' in t.node &&
      !purposeBuilt.has(String(t.node.name))),
  mount(body, initial) {
    let context = initial;
    const root = el('div'),
      error = el('p');
    error.setAttribute('role', 'alert');
    error.className = 'editor-error';
    const fields = new Map<number, { field: HTMLInputElement; arg: Arg }>();
    const call = callAt(context.doc, context.target.nodeId);
    root.append(
      el('h3', call?.name ?? 'Named call'),
      el('p', "ODM doesn't have a description for this yet"),
    );
    call?.args.forEach((arg, index) => {
      const item = el('div');
      item.className = 'editor-list-item';
      const label = `Argument ${index + 1}`;
      const core =
        arg.kind === 'pattern' && !arg.pattern.layers.length ? arg.pattern.core : undefined;
      const value =
        arg.kind === 'literal'
          ? arg.value
          : core?.kind === 'constant'
            ? core.value
            : core?.kind === 'sequence'
              ? core.notation
              : undefined;
      if (typeof value === 'number' || typeof value === 'string') {
        const form = el('form'),
          field = el('input'),
          save = el('button', 'Apply');
        field.type = typeof value === 'number' ? 'number' : 'text';
        field.step = 'any';
        field.value = String(value);
        field.setAttribute('aria-label', label);
        form.append(fieldLabel(label, field), save);
        form.onsubmit = (e) => {
          e.preventDefault();
          const next = setGenericArgument(context.doc, context.target.nodeId, index, field.value);
          error.textContent = 'ok' in next ? next.reason : '';
          if (!('ok' in next)) context.apply(next);
        };
        fields.set(index, { field, arg });
        item.append(form);
      } else {
        item.append(
          el(
            'p',
            `${label}: ${arg.kind === 'callback' ? 'Callback · ' : ''}${argumentSource(arg)}`,
          ),
        );
        if (arg.kind !== 'callback') {
          const open = el(
            'button',
            arg.kind === 'pattern' ? 'Open pattern' : 'Edit argument as source',
          );
          open.onclick = () =>
            context.apply(context.doc, {
              selection:
                arg.kind === 'pattern'
                  ? callAt(context.doc, arg.pattern.id) ||
                    describeTarget(context.doc, arg.pattern.id).kind !== 'unknown'
                    ? arg.pattern.id
                    : `${arg.pattern.id}:source`
                  : `${context.target.nodeId}:arg:${index}`,
            });
          item.append(open);
        } else item.append(el('p', 'Use Edit as source to change the whole call.'));
      }
      root.append(item);
    });
    const owner = rewriteOwner(context.doc, context.target.nodeId);
    if (owner) {
      const ordered = el('ol');
      ordered.setAttribute('aria-label', 'Rewrites · in order');
      owner.pattern.layers.forEach((layer) => {
        if (layer.kind !== 'rewrite') return;
        const item = el('li'),
          open = el('button', layer.name);
        if (layer.id === context.target.nodeId) open.setAttribute('aria-current', 'true');
        open.onclick = () => context.apply(context.doc, { selection: layer.id });
        item.append(open);
        ordered.append(item);
      });
      root.append(el('h4', 'Rewrites · in order'), ordered);
    }
    root.append(error);
    body.append(root);
    return {
      update(next) {
        context = next;
        const call = callAt(next.doc, next.target.nodeId);
        fields.forEach((entry, index) => {
          const arg = call?.args[index];
          if (!arg || arg === entry.arg) return;
          const core = arg.kind === 'pattern' ? arg.pattern.core : undefined;
          entry.field.value = String(
            arg.kind === 'literal'
              ? arg.value
              : core?.kind === 'constant'
                ? core.value
                : core?.kind === 'sequence'
                  ? core.notation
                  : '',
          );
          entry.arg = arg;
        });
      },
      destroy() {
        root.remove();
      },
    };
  },
} satisfies EditorKind;
