import type { EditorKind, EditorContext } from '../kind';
import type { Constant } from '../../document/edit';
import { setConstant } from '../../document/edits/set-constant';
import { controlInfo, sliderValue, fromSlider } from '../controls';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
let serial = 0;
export default {
  id: 'constant',
  priority: 10,
  matches: (target) => target.kind === 'setting-constant',
  mount(body, initial) {
    let context = initial,
      target = initial.target;
    let slider: HTMLInputElement | undefined;
    let gesture: string | undefined;
    const edit = (value: Constant, gesture?: string) => {
      const next = setConstant(context.doc, target.nodeId, value);
      if (!('ok' in next)) context.apply(next, { gesture });
    };
    function input(type: string, label: string) {
      const n = el('input');
      n.type = type;
      n.setAttribute('aria-label', label);
      return n;
    }
    function step(event: KeyboardEvent) {
      if (
        !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) ||
        typeof target.value !== 'number'
      )
        return;
      event.preventDefault();
      const delta =
        (controlInfo(target.control)?.step ?? 1) *
        (event.shiftKey ? 10 : 1) *
        (['ArrowDown', 'ArrowLeft'].includes(event.key) ? -1 : 1);
      edit(Number((target.value + delta).toPrecision(12)));
    }

    const label = target.breadcrumb.join(' › '),
      info = controlInfo(target.control);
    if (typeof target.value === 'number' && info) {
      slider = input('range', label);
      slider.min = '0';
      slider.max = '1';
      slider.step = '0.001';
      slider.onpointerdown = (event) => {
        slider!.setPointerCapture(event.pointerId);
        gesture = `drag-${++serial}`;
      };
      slider.onpointerup = slider.onpointercancel = () => {
        gesture = undefined;
      };
      slider.onkeydown = step;
      slider.oninput = () => edit(fromSlider(info, Number(slider!.value)), gesture);
      body.append(slider);
    }
    const field = input(
      typeof target.value === 'boolean'
        ? 'checkbox'
        : typeof target.value === 'number'
          ? 'number'
          : 'text',
      `${label} exact value`,
    );
    if (field.type === 'number') {
      field.step = 'any';
      field.onkeydown = (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          field!.dispatchEvent(new Event('change'));
        } else step(event);
      };
    }
    field.onchange = () => {
      if (field!.type === 'number') {
        if (field!.value.trim() && Number.isFinite(field!.valueAsNumber))
          edit(field!.valueAsNumber);
      } else edit(field!.type === 'checkbox' ? field!.checked : field!.value);
    };
    const labelNode = el('label', typeof target.value === 'boolean' ? 'Enabled' : 'Exact value');
    labelNode.append(field);
    if (typeof target.value === 'number' && info?.unit) labelNode.append(el('span', info.unit));
    body.append(labelNode);

    function update(nextContext: EditorContext) {
      const valueChanged =
        target.nodeId !== nextContext.target.nodeId || target.value !== nextContext.target.value;
      context = nextContext;
      target = context.target;
      if (field) {
        if (field.type === 'checkbox') field.checked = target.value === true;
        else if (
          valueChanged ||
          document.activeElement !== field ||
          field.value === String(target.value) ||
          context.pending === 'failed'
        )
          field.value = String(target.value);
      }
      if (slider) {
        slider.value = String(sliderValue(controlInfo(target.control)!, Number(target.value)));
        slider.setAttribute(
          'aria-valuetext',
          `${target.value} ${controlInfo(target.control)!.unit}`,
        );
      }
    }
    update(initial);
    return {
      update,
      destroy() {
        body.replaceChildren();
      },
    };
  },
} satisfies EditorKind;
