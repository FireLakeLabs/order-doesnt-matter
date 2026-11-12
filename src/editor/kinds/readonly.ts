import type { EditorKind, EditorContext } from '../kind';
export default {
  id: 'readonly',
  priority: 0,
  matches: () => true,
  mount(body, context) {
    const text = document.createElement('p');
    body.append(text);
    function update({ target, events, window }: EditorContext) {
      const values = events?.events
        .filter((e) => e.part[0] < window.toCycle && e.part[1] > window.fromCycle)
        .slice(0, 8)
        .map((e) => JSON.stringify(e.value));
      const current =
        ['instrument', 'rewrite', 'rhythm'].includes(target.kind) && values?.length
          ? [...new Set(values)].join('; ')
          : target.displayValue;
      text.textContent = `${target.value ?? (current || 'Current values unavailable')}, ${target.reason}`;
    }
    update(context);
    return {
      update,
      destroy() {
        text.remove();
      },
    };
  },
} satisfies EditorKind;
