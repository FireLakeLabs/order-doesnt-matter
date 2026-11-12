import type { EditorKind, EditorContext } from '../kind';
import { describeTarget } from '../../document/edit';
import { prepareSource } from '../../document/edits/source-node';
import { sourceFragment } from '../../document/edits/source-shared';
import { fieldLabel } from '../presentation';
import './source.css';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
export default {
  id: 'source',
  priority: 30,
  matches: (t) => t.kind === 'source',
  mount(body, initial) {
    let context = initial,
      disposed = false,
      busy = false;
    const form = el('form'),
      field = el('textarea'),
      apply = el('button', 'Apply'),
      revert = el('button', 'Revert'),
      error = el('p'),
      status = el('p');
    field.rows = 8;
    field.spellcheck = false;
    field.className = 'source-text';
    field.setAttribute('aria-label', 'Source text');
    field.value = sourceFragment(initial.doc, initial.target.nodeId) ?? '';
    error.className = 'editor-error';
    error.setAttribute('role', 'alert');
    status.className = 'editor-helper';
    status.setAttribute('role', 'status');
    revert.type = 'button';
    revert.onclick = () => {
      field.value = sourceFragment(context.doc, context.target.nodeId) ?? '';
      error.textContent = '';
      field.removeAttribute('aria-invalid');
    };
    const actions = el('div');
    actions.className = 'editor-actions';
    actions.append(apply, revert);
    form.append(fieldLabel('Source text', field), actions, error, status);
    body.append(form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      const before = context.doc,
        id = context.target.nodeId,
        text = field.value;
      error.textContent = '';
      busy = true;
      apply.disabled = revert.disabled = true;
      status.textContent = 'Checking the notes…';
      const result = await prepareSource(before, id, text, context.ask);
      busy = false;
      apply.disabled = revert.disabled = false;
      if (disposed) return;
      if (context.doc !== before) {
        status.textContent =
          'The piece changed while checking. Your text is kept; apply again when ready.';
        return;
      }
      field.setAttribute('aria-invalid', String('ok' in result));
      if ('ok' in result) {
        error.textContent = result.reason;
        status.textContent = '';
        return;
      }
      const { doc: chosen, broken, promoted } = result;
      context.apply(chosen);
      error.textContent = broken ? `Broken: ${broken}. Use Undo to restore the previous edit.` : '';
      const native = describeTarget(chosen, id.replace(/:source$/, ''));
      status.textContent =
        promoted && native.kind !== 'source'
          ? 'Applied. This is now editable in its own editor.'
          : 'Applied. Your source text is kept.';
    };
    return {
      update(next: EditorContext) {
        context = next;
        if (next.pending === 'failed')
          error.textContent =
            'This change failed. Your text is kept; use Revert to see the current piece.';
      },
      destroy() {
        disposed = true;
        form.remove();
      },
    };
  },
} satisfies EditorKind;
