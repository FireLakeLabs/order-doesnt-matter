import type { EditorContext, EditorKind } from '../kind';
import { instruments, sections, type Doc } from '../../document';
import { setSectionLength } from '../../document/edits/section-length';
import { renameSection } from '../../document/edits/section-rename';
import { setInstrumentInSection } from '../../document/edits/section-instrument';
import { moveSection } from '../../document/edits/section-move';
import { duplicateSection } from '../../document/edits/section-duplicate';
import { removeSection } from '../../document/edits/section-remove';
import { addSection } from '../../document/edits/section-add';
import { separateSection } from '../../document/edits/section-separate';
import { makeSections } from '../../document/edits/section-make';
import { sectionUses } from '../../document/edits/section-shared';
import type { Refusal } from '../../document/edits/shared';
import { fieldLabel, toggle } from '../presentation';
import './section.css';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
export default {
  id: 'section',
  priority: 10,
  matches: (target) =>
    target.kind === 'section' ||
    ['piece:add-section', 'piece:make-sections'].includes(target.nodeId),
  mount(body, initial) {
    let context = initial,
      rendered: Doc | undefined,
      destroyed = false;
    const root = el('div'),
      error = el('p'),
      offer = el('div');
    error.setAttribute('role', 'alert');
    root.className = 'section-editor';
    body.append(root, error, offer);
    function apply(next: Doc | Refusal, selection?: string) {
      error.textContent = 'ok' in next ? next.reason : '';
      offer.replaceChildren();
      if (!('ok' in next)) context.apply(next, { selection });
    }
    function button(text: string, action: () => void, key = text) {
      const node = el('button', text);
      node.type = 'button';
      node.dataset.sectionKey = key;
      node.onclick = action;
      return node;
    }
    function create(make = false) {
      const next = make ? makeSections(context.doc) : addSection(context.doc);
      apply(next, 'ok' in next ? undefined : sections(next).at(make ? 0 : -1)!.id);
      body.querySelector<HTMLInputElement>('.editor-toggle input')?.focus({ preventScroll: true });
    }
    function update(next: EditorContext) {
      context = next;
      if (rendered === next.doc) return;
      rendered = next.doc;
      const active = document.activeElement as HTMLElement | null,
        key = active?.dataset.sectionKey;
      root.replaceChildren();
      if (next.target.nodeId === 'piece:make-sections') {
        root.append(
          el('p', 'Make sections'),
          el(
            'p',
            'The first 4 cycles will become Section 1. The section order will repeat every 4 cycles. The original piece had no set length. Notes within a section can keep changing on later repeats.',
          ),
          button('Make sections', () => create(true)),
        );
        return;
      }
      const part = sections(next.doc).find((s) => s.id === next.target.nodeId);
      if (!part) return;
      const intro = el('p', 'Edit this section'),
        generated = el(
          'p',
          part.nameSource === 'generated' ? 'Generated name — rename it to make it yours' : '',
        );
      generated.className = 'editor-helper';
      const name = el('input'),
        length = el('input'),
        form = el('form');
      name.value = part.name;
      name.dataset.sectionKey = 'name';
      name.setAttribute('aria-label', 'Section name');
      length.type = 'number';
      length.value = String(part.cycles);
      length.min = Number.isInteger(part.cycles) ? '1' : '0';
      length.step = Number.isInteger(part.cycles) ? '1' : 'any';
      length.setAttribute('aria-label', 'Length in cycles');
      length.dataset.sectionKey = 'length';
      const changeLength = () =>
        apply(
          setSectionLength(context.doc, part.id, length.value.trim() ? length.valueAsNumber : NaN),
        );
      length.onchange = changeLength;
      length.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          changeLength();
        }
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        apply(renameSection(context.doc, part.id, name.value));
      };
      const save = el('button', 'Rename');
      form.append(fieldLabel('Section name', name), save, generated);
      root.append(intro, form, fieldLabel('Length', length, 'cycles'));
      const count = sectionUses(next.doc, part.id);
      if (count > 1)
        root.append(
          el(
            'p',
            `This section is used ${count} times; the change applies to ${count === 2 ? 'both' : 'all uses'}. Length and order affect only this occurrence.`,
          ),
          button('Make this one separate', () => apply(separateSection(context.doc, part.id))),
        );
      root.append(el('h3', 'Who plays'));
      const list = el('div');
      list.className = 'editor-list';
      instruments(next.doc).forEach((row) => {
        const control = toggle(row.name.replaceAll('$', ''));
        control.input.checked = part.instrumentIds.includes(row.id);
        control.input.dataset.sectionKey = row.id;
        if (row.nameSource === 'generated') control.label.append(el('small', 'generated'));
        control.input.onchange = () => {
          const result = setInstrumentInSection(
            context.doc,
            part.id,
            row.id,
            control.input.checked,
          );
          apply(result);
          if ('ok' in result) {
            control.input.checked = !control.input.checked;
            if (result.reason.includes('Give it a name first'))
              offer.append(
                button('Give it a name first', () =>
                  context.apply(context.doc, { selection: row.id }),
                ),
              );
          }
        };
        list.append(control.label);
      });
      const actions = el('div');
      actions.className = 'editor-actions';
      for (const [label, direction] of [
        ['Move earlier', -1],
        ['Move later', 1],
      ] as const) {
        const move = button(label, () => apply(moveSection(context.doc, part.id, direction)));
        move.disabled = 'ok' in moveSection(next.doc, part.id, direction);
        actions.append(move);
      }
      actions.append(button('Duplicate', () => apply(duplicateSection(context.doc, part.id))));
      const remove = button('Remove from song', () => {
        const result = removeSection(context.doc, part.id);
        apply(result, 'ok' in result ? undefined : sections(result)[0].id);
      });
      remove.disabled = sections(next.doc).length === 1;
      actions.append(remove);
      root.append(list, actions);
      if (key)
        Array.from(root.querySelectorAll<HTMLElement>('[data-section-key]'))
          .find((n) => n.dataset.sectionKey === key)
          ?.focus({ preventScroll: true });
    }
    update(initial);
    if (initial.target.nodeId === 'piece:add-section')
      queueMicrotask(() => {
        if (!destroyed) create();
      });
    return {
      update,
      destroy() {
        destroyed = true;
        body.replaceChildren();
      },
    };
  },
} satisfies EditorKind;
