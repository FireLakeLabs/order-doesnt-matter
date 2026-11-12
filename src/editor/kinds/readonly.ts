import type { EditorKind, EditorContext } from '../kind';
export default {
  id: 'readonly',
  priority: 0,
  matches: () => true,
  mount(body, context) {
    const text = document.createElement('p');
    const value = document.createElement('p');
    value.className = 'editor-read-value';
    text.className = 'editor-helper';
    body.append(value, text);
    function update({ target, events, window }: EditorContext) {
      const values = events?.events
        .filter((e) => e.part[0] < window.toCycle && e.part[1] > window.fromCycle)
        .slice(0, 8)
        .map((e) => JSON.stringify(e.value));
      const current =
        ['instrument', 'rewrite', 'rhythm'].includes(target.kind) && values?.length
          ? [...new Set(values)].join('; ')
          : target.displayValue;
      value.textContent = String(
        target.value ??
          (target.kind === 'rhythm' ? target.displayValue : current) ??
          'Current values unavailable',
      );
      text.textContent =
        target.kind === 'rhythm'
          ? 'Edit this rhythm in the pasted program.'
          : target.kind === 'section'
            ? 'Edit this section in the pasted program.'
            : target.reason;
    }
    update(context);
    return {
      update,
      destroy() {
        value.remove();
        text.remove();
      },
    };
  },
} satisfies EditorKind;
