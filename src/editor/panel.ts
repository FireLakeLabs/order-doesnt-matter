import type { Target, Constant } from '../document/edit';
import type { PendingEntry } from './pending';
import { controlInfo, sliderValue, fromSlider } from './controls';
import './style.css';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
export function createPanel(
  host: HTMLElement,
  edit: (value: Constant, gesture?: string) => void,
  close: () => void,
) {
  let id = '',
    target: Target,
    field: HTMLInputElement | undefined,
    slider: HTMLInputElement | undefined;
  let gesture: string | undefined,
    serial = 0;
  const heading = el('h2'),
    status = el('p'),
    body = el('div'),
    done = el('button', 'Done');
  heading.id = 'editor-breadcrumb';
  status.id = 'editor-status';
  status.setAttribute('role', 'status');
  done.onclick = close;
  host.setAttribute('aria-labelledby', heading.id);
  host.setAttribute('role', 'region');
  host.append(heading, body, status, done);
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
  return (next: Target | null, entry: PendingEntry | undefined, playing: boolean, summary = '') => {
    host.hidden = !next;
    if (!next) {
      id = '';
      return;
    }
    const valueChanged = target?.nodeId !== next.nodeId || target?.value !== next.value;
    target = next;
    if (id !== next.nodeId) {
      id = next.nodeId;
      heading.replaceChildren();
      body.replaceChildren();
      field = undefined;
      slider = undefined;
      gesture = undefined;
      next.breadcrumb.forEach((part, i) => {
        if (i) heading.append(document.createTextNode(' › '));
        heading.append(el(i === 0 && next.generated ? 'em' : 'span', part));
      });
      if (next.generated) {
        const alt = el('span', ' (generated instrument name)');
        alt.className = 'sheet-sr-only';
        heading.append(alt);
      }
      if (next.editable) {
        const label = next.breadcrumb.join(' › '),
          info = controlInfo(next.control);
        if (typeof next.value === 'number' && info) {
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
        field = input(
          typeof next.value === 'boolean'
            ? 'checkbox'
            : typeof next.value === 'number'
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
        const labelNode = el('label', typeof next.value === 'boolean' ? 'Enabled' : 'Exact value');
        labelNode.append(field);
        if (typeof next.value === 'number' && info?.unit) labelNode.append(el('span', info.unit));
        body.append(labelNode);
      } else
        body.append(
          el(
            'p',
            `${next.value ?? (next.displayValue || summary || 'Current values unavailable')}, ${next.reason}`,
          ),
        );
    }
    if (field) {
      if (field.type === 'checkbox') field.checked = next.value === true;
      else if (
        valueChanged ||
        document.activeElement !== field ||
        field.value === String(next.value) ||
        entry?.status === 'failed'
      )
        field.value = String(next.value);
    }
    if (slider) {
      slider.value = String(sliderValue(controlInfo(next.control)!, Number(next.value)));
      slider.setAttribute('aria-valuetext', `${next.value} ${controlInfo(next.control)!.unit}`);
    }
    host.dataset.editState = entry?.status ?? '';
    status.textContent =
      entry?.status === 'failed'
        ? `Change failed: ${entry.reason}. Previous value restored.`
        : entry?.status === 'pending'
          ? 'Changing — not playing yet'
          : playing
            ? 'Playing now'
            : 'Plays on next start';
  };
}
