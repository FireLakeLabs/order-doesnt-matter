import type { EditorKind, EditorContext } from '../kind';
import type { Doc, Step } from '../../document';
import type { Refusal } from '../../document/edit';
import { printSteps } from '../../import/mini';
import { controlInfo, fromSlider, sliderValue } from '../controls';
import { isGroup, valueSetting } from '../../document/edits/values-shared';
import { setValue } from '../../document/edits/values-set';
import { insertValue } from '../../document/edits/values-insert';
import { removeValue } from '../../document/edits/values-remove';
import { moveValue } from '../../document/edits/values-move';
import { changeGroup } from '../../document/edits/values-group';
import { toggleRest } from '../../document/edits/values-rest';
import { setModifier } from '../../document/edits/values-modifier';
import { replaceChunk } from '../../document/edits/values-chunk';
import { convertValues } from '../../document/edits/values-convert';
import './values.css';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
const words = {
  sub: 'One after another within a cycle',
  alternate: 'One per cycle, taking turns',
  together: 'At the same time',
};
let serial = 0;
export default {
  id: 'values',
  priority: 10,
  matches: (target) => target.kind === 'setting-values',
  conversions(target, doc) {
    const to =
      target.kind === 'setting-constant'
        ? 'values'
        : target.kind === 'setting-values'
          ? 'constant'
          : undefined;
    return to
      ? [
          {
            label: to === 'values' ? 'Change over time' : 'Make it one value',
            apply: () => convertValues(doc, target.nodeId, to),
          },
        ]
      : [];
  },
  mount(body, initial) {
    let context = initial,
      signature = '',
      updates: (() => void)[] = [];
    const root = el('div'),
      lane = el('div'),
      form = el('div'),
      error = el('p');
    root.className = 'values-editor';
    lane.className = 'values-lane';
    error.setAttribute('role', 'alert');
    root.append(lane, form, error);
    body.append(root);
    const steps = () => {
      const c = valueSetting(context.doc, context.target.nodeId)?.node.value.core;
      return c?.kind === 'sequence' ? c.steps : undefined;
    };
    function at(path: number[]): Step | undefined {
      let list = steps(),
        step: Step | undefined;
      for (const i of path) {
        step = list?.[i];
        list = step && isGroup(step) ? step.steps : undefined;
      }
      return step;
    }
    function apply(result: Doc | Refusal, gesture?: string) {
      error.textContent = 'ok' in result ? result.reason : '';
      if (!('ok' in result)) context.apply(result, { gesture });
    }
    const edit = (operation: (doc: Doc, id: string) => Doc | Refusal, gesture?: string) =>
      apply(operation(context.doc, context.target.nodeId), gesture);
    function button(parent: HTMLElement, text: string, action: () => void, disabled = false) {
      const b = el('button', text);
      b.type = 'button';
      b.disabled = disabled;
      b.onclick = action;
      parent.append(b);
      return b;
    }
    function field(
      parent: HTMLElement,
      label: string,
      type: string,
      value: () => string,
      change: (s: string) => void,
    ) {
      const wrap = el('label', label),
        input = el('input');
      input.type = type;
      input.setAttribute('aria-label', label);
      input.step = 'any';
      input.onchange = () => change(input.value);
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.dispatchEvent(new Event('change'));
        }
      };
      let previous: string | undefined;
      updates.push(() => {
        const next = value();
        if (next !== previous || document.activeElement !== input || context.pending === 'failed')
          input.value = next;
        previous = next;
      });
      wrap.append(input);
      parent.append(wrap);
      return input;
    }
    function group(list: Step[], parent: HTMLElement, path: number[]) {
      const box = el('fieldset'),
        legend = el('legend', path.length ? `Group ${path.map((i) => i + 1).join('.')}` : 'Values');
      box.append(legend);
      parent.append(box);
      const current = path.length ? at(path) : { kind: 'sub' as const };
      if (current?.kind === 'sub' || current?.kind === 'alternate') {
        const select = el('select');
        select.setAttribute('aria-label', `${legend.textContent} timing`);
        for (const kind of ['sub', 'alternate'] as const) {
          const option = el('option', words[kind]);
          option.value = kind;
          select.append(option);
        }
        select.value = current.kind;
        select.onchange = () =>
          edit((d, id) => changeGroup(d, id, path, select.value as 'sub' | 'alternate'));
        box.append(select);
      } else box.append(el('p', words.together));
      list.forEach((s, i) => {
        const p = [...path, i],
          label = `Value ${p.map((j) => j + 1).join('.')}`,
          row = el('div');
        row.className = 'values-step';
        box.append(row);
        if (isGroup(s)) group(s.steps, row, p);
        else if (s.kind === 'value') {
          const numeric = Number.isFinite(Number(s.value)),
            info = controlInfo(context.target.control);
          if (numeric && info) {
            let gesture: string | undefined;
            const slider = el('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '1';
            slider.step = '.001';
            slider.setAttribute('aria-label', `${label} slider`);
            slider.onpointerdown = (e) => {
              slider.setPointerCapture(e.pointerId);
              gesture = `values-${++serial}`;
            };
            slider.onpointerup = slider.onpointercancel = () => {
              gesture = undefined;
            };
            slider.oninput = () =>
              edit(
                (d, id) => setValue(d, id, p, String(fromSlider(info, Number(slider.value)))),
                gesture,
              );
            updates.push(() => {
              const current = at(p);
              if (current?.kind === 'value') {
                slider.value = String(sliderValue(info, Number(current.value)));
                slider.setAttribute('aria-valuetext', `${current.value} ${info.unit}`);
              }
            });
            row.append(slider);
          }
          field(
            row,
            `${label}${info?.unit && numeric ? ` (${info.unit})` : ''}`,
            numeric ? 'number' : 'text',
            () => {
              const current = at(p);
              return current?.kind === 'value' ? current.value : '';
            },
            (value) => edit((d, id) => setValue(d, id, p, value)),
          );
        } else if (s.kind === 'rest')
          row.append(el('p', `${label}: off${s.was ? ` (${s.was})` : ''}`));
        else {
          const names = {
            euclid: 'Evenly distributed pattern',
            polymeter: 'Different cycle lengths',
            choose: 'Random choice',
            other: 'Text pattern',
          };
          const textarea = el('textarea');
          textarea.setAttribute('aria-label', `${label}: ${names[s.kind]}`);
          textarea.value = printSteps([s]);
          row.append(el('label', names[s.kind]), textarea);
          button(row, 'Save text', () => edit((d, id) => replaceChunk(d, id, p, textarea.value)));
          updates.push(() => {
            if (document.activeElement !== textarea) {
              const current = at(p);
              if (current) textarea.value = printSteps([current]);
            }
          });
        }
        if (s.kind === 'value' || s.kind === 'rest')
          button(row, s.kind === 'rest' ? 'Switch on' : 'Switch off', () =>
            edit((d, id) => toggleRest(d, id, p)),
          );
        for (const name of ['weight', 'repeat', 'chance'] as const)
          if (name in s) {
            const labels = {
              weight: 'Relative length',
              repeat: 'Repeats',
              chance: 'Chance of leaving out',
            };
            field(
              row,
              `${label} ${labels[name]}`,
              'number',
              () => String((at(p) as unknown as Record<string, unknown>)?.[name] ?? ''),
              (value) => edit((d, id) => setModifier(d, id, p, name, Number(value))),
            );
          }
        const actions = el('div');
        actions.className = 'values-actions';
        row.append(actions);
        button(actions, 'Earlier', () => edit((d, id) => moveValue(d, id, p, i - 1)), i === 0);
        button(
          actions,
          'Later',
          () => edit((d, id) => moveValue(d, id, p, i + 1)),
          i === list.length - 1,
        );
        button(actions, 'Remove', () => edit((d, id) => removeValue(d, id, p)), list.length === 1);
      });
      button(box, 'Add value', () => edit((d, id) => insertValue(d, id, path, list.length)));
    }
    function drawLane() {
      lane.replaceChildren(
        el('p', `Scored values · cycles ${context.window.fromCycle}–${context.window.toCycle}`),
      );
      if (!context.events || context.events.error) {
        lane.append(
          el(
            'p',
            context.events?.error
              ? `Values unavailable: ${context.events.error.message}`
              : 'Loading values…',
          ),
        );
        return;
      }
      const { fromCycle: from, toCycle: to } = context.window;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 1000 80');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Setting values at their actual event spans');
      // Aliases in events use canonical engine names.
      const key =
        (
          { lpf: 'cutoff', hpf: 'hcutoff', roomsize: 'size', resonance: 'resonance' } as Record<
            string,
            string
          >
        )[context.target.control] ?? context.target.control;
      let count = 0;
      const values = new Set<string>();
      for (const event of context.events.events) {
        const start = Math.max(from, event.part[0]),
          end = Math.min(to, event.part[1]);
        if (end <= start) continue;
        const value = (event.value as Record<string, unknown>)?.[key];
        if (value === undefined) continue;
        values.add(String(value));
        const rect = document.createElementNS(svg.namespaceURI, 'rect'),
          title = document.createElementNS(svg.namespaceURI, 'title');
        rect.setAttribute('x', String(((start - from) / (to - from)) * 1000));
        rect.setAttribute('width', String(((end - start) / (to - from)) * 1000));
        rect.setAttribute('y', '8');
        rect.setAttribute('height', '52');
        rect.setAttribute(
          'fill',
          ['#a3efd5', '#c3b0f1', '#f0cb86'][[...values].indexOf(String(value)) % 3],
        );
        count++;
        title.textContent = `${value} · ${event.part[0]}–${event.part[1]}`;
        rect.append(title);
        svg.append(rect);
      }
      lane.append(svg);
      lane.append(el('p', count ? [...values].join(' · ') : 'No values in this window'));
    }
    function update(next: EditorContext) {
      context = next;
      const list = steps();
      const shape = JSON.stringify(list, (key, value) =>
        ['value', 'weight', 'repeat', 'chance', 'was', 'notation'].includes(key)
          ? key === 'value'
            ? Number.isFinite(Number(value))
              ? 'number'
              : 'text'
            : typeof value
          : value,
      );
      if (shape !== signature) {
        const focused = root.contains(document.activeElement)
          ? (document.activeElement as HTMLElement).getAttribute('aria-label')
          : null;
        signature = shape;
        updates = [];
        form.replaceChildren();
        if (list) {
          if (list.length === 1 && isGroup(list[0])) group(list[0].steps, form, [0]);
          else group(list, form, []);
        } else
          form.append(
            el(
              'p',
              'This value uses a shared name or another pattern form. Edit its definition in the pasted program.',
            ),
          );
        if (focused)
          Array.from(form.querySelectorAll<HTMLElement>('[aria-label]'))
            .find((n) => n.getAttribute('aria-label') === focused)
            ?.focus({ preventScroll: true });
      }
      updates.forEach((update) => update());
      drawLane();
    }
    update(initial);
    return {
      update,
      destroy() {
        root.remove();
      },
    };
  },
} satisfies EditorKind;
