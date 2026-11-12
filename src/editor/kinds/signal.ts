import type { EditorContext, EditorKind } from '../kind';
import type { Doc } from '../../document';
import type { Refusal } from '../../document/edit';
import { signalState, signalShapes } from '../../document/edits/signal-shared';
import { setSignalShape } from '../../document/edits/signal-shape';
import { setSignalRange } from '../../document/edits/signal-range';
import { setSignalPeriod } from '../../document/edits/signal-period';
import { constantToSignal } from '../../document/edits/signal-from-constant';
import { signalToConstant } from '../../document/edits/signal-to-constant';
import { controlInfo, sliderValue, fromSlider } from '../controls';
import { fieldLabel, withUnit, displayNumber } from '../presentation';
import './signal.css';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
const descriptions = [
  'Smooth rise and fall',
  'Smooth fall then rise',
  'Steady rise, then restart',
  'Steady fall, then restart',
  'Straight rise and fall',
  'Alternate low and high',
  'Wandering, smooth values',
  'Scattered random values',
];
const sketches = [
  (t: number) => (1 + Math.sin(t * Math.PI * 2)) / 2,
  (t: number) => (1 + Math.cos(t * Math.PI * 2)) / 2,
  (t: number) => t,
  (t: number) => 1 - t,
  (t: number) => 1 - Math.abs(2 * t - 1),
  (t: number) => (t < 0.5 ? 0 : 1),
  (t: number) => 0.5 + 0.25 * Math.sin(t * 9) + 0.1 * Math.cos(t * 23),
  (t: number) => ((Math.sin(t * 127) * 43758) % 1) / 2 + 0.5,
];
function curve() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS(svg.namespaceURI, 'polyline');
  svg.setAttribute('viewBox', '0 0 240 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  svg.append(path);
  return { svg, path };
}
let serial = 0;
export default {
  id: 'signal',
  priority: 10,
  matches: (t) => t.kind === 'setting-signal',
  conversions(target, doc) {
    if (target.kind === 'setting-constant' && typeof target.value === 'number')
      return [{ label: 'Drive with a signal', apply: () => constantToSignal(doc, target.nodeId) }];
    if (target.kind === 'setting-signal')
      return [{ label: 'Make it one value', apply: () => signalToConstant(doc, target.nodeId) }];
    return [];
  },
  mount(body, initial) {
    let context = initial;
    const root = el('div');
    root.className = 'signal-editor';
    const caption = el('p'),
      bounds = el('p'),
      plot = curve(),
      note = el('p'),
      error = el('p');
    plot.svg.classList.add('signal-curve');
    plot.svg.setAttribute('role', 'img');
    plot.svg.setAttribute('aria-label', 'Real setting values over the current window');
    bounds.className = 'editor-helper';
    error.setAttribute('role', 'alert');
    const info = controlInfo(context.target.control) ?? {
      min: 0,
      max: 1,
      step: 0.01,
      unit: '',
      scale: 'linear' as const,
    };
    const position = (value: number) =>
      Math.max(
        0,
        Math.min(1, sliderValue(info, info.scale === 'log' ? Math.max(info.min, value) : value)),
      );
    const apply = (next: Doc | Refusal, gesture?: string) => {
      if ('ok' in next) error.textContent = next.reason;
      else {
        error.textContent = '';
        context.apply(next, { gesture });
      }
    };
    const fields = el('div');
    fields.className = 'signal-fields';
    function field(label: string, edit: (value: number) => void, fraction = false) {
      const input = el('input'),
        wrap = fieldLabel(label, input, fraction ? 'cycles' : info.unit);
      input.type = fraction ? 'text' : 'number';
      input.setAttribute('aria-label', label);
      if (!fraction) input.step = 'any';
      const commit = () => {
        const parts = input.value.trim().split('/');
        const n =
          parts.length <= 2 && parts.every((p) => p.trim())
            ? Number(parts[0]) / (parts.length === 2 ? Number(parts[1]) : 1)
            : NaN;
        if (Number.isFinite(n)) edit(n);
        else error.textContent = 'Enter a finite number or fraction';
      };
      input.onchange = commit;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      };

      fields.append(wrap);
      return input;
    }
    const editBound = (which: number, value: number, gesture?: string) => {
      const s = signalState(context.doc, context.target.nodeId);
      if ('ok' in s) return apply(s);
      apply(
        setSignalRange(
          context.doc,
          context.target.nodeId,
          which === 0 ? value : s.low!,
          which === 1 ? value : s.high!,
        ),
        gesture,
      );
    };
    const low = field('Low bound', (v) => editBound(0, v));
    const high = field('High bound', (v) => editBound(1, v));
    const period = field(
      'One sweep every N cycles',
      (v) => apply(setSignalPeriod(context.doc, context.target.nodeId, v)),
      true,
    );
    const tracks = fields;
    const handles = [0, 1].map((which) => {
      const button = el('button'),
        rail = el('div');
      rail.className = 'signal-track';
      button.setAttribute('role', 'slider');
      button.type = 'button';
      button.setAttribute('aria-label', `${which === 0 ? 'Low' : 'High'} bound slider`);
      button.setAttribute('aria-valuemin', String(info.min));
      button.setAttribute('aria-valuemax', String(info.max));
      button.setAttribute('aria-orientation', 'horizontal');
      button.onfocus = () => button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      let drag: { x: number; position: number; gesture: string } | undefined;
      button.onpointerdown = (e) => {
        const s = signalState(context.doc, context.target.nodeId);
        if ('ok' in s) return;
        button.setPointerCapture(e.pointerId);
        drag = {
          x: e.clientX,
          position: position(which === 0 ? s.low! : s.high!),
          gesture: `signal-${++serial}`,
        };
      };
      button.onpointermove = (e) => {
        if (!drag) return;
        const position = Math.max(
          0,
          Math.min(1, drag.position + (e.clientX - drag.x) / Math.max(1, rail.clientWidth - 44)),
        );
        editBound(which, fromSlider(info, position), drag.gesture);
      };
      button.onpointerup = button.onpointercancel = () => {
        drag = undefined;
      };
      button.onkeydown = (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const s = signalState(context.doc, context.target.nodeId);
        if ('ok' in s) return;
        const v = which === 0 ? s.low! : s.high!,
          direction = ['ArrowLeft', 'ArrowDown'].includes(e.key) ? -1 : 1;
        const next =
          info.scale === 'log'
            ? fromSlider(info, sliderValue(info, v) + direction * 0.01 * (e.shiftKey ? 10 : 1))
            : Number((v + direction * info.step * (e.shiftKey ? 10 : 1)).toPrecision(12));
        editBound(which, next);
      };
      rail.append(button);
      const exact = (which === 0 ? low : high).closest('label')!;
      exact.after(rail);
      return button;
    });
    const shapes = el('details'),
      summary = el('summary'),
      choices = el('div');
    choices.className = 'signal-shapes';
    const buttons = signalShapes.map((shape, i) => {
      const b = el('button'),
        title = el('strong', shape),
        desc = el('small', descriptions[i]),
        sketch = curve();
      sketch.svg.setAttribute('aria-hidden', 'true');
      sketch.path.setAttribute(
        'points',
        Array.from({ length: 33 }, (_, j) => `${j * 7.5},${95 - 90 * sketches[i](j / 32)}`).join(
          ' ',
        ),
      );
      b.type = 'button';
      b.setAttribute('aria-label', shape);
      b.append(title, sketch.svg, desc);
      b.onclick = () => apply(setSignalShape(context.doc, context.target.nodeId, shape));
      choices.append(b);
      return b;
    });
    shapes.append(summary, choices);
    const others = el('ol'),
      otherTitle = el('h3', 'Other rewrites · in order');
    caption.className = 'editor-helper';
    note.className = 'editor-helper';
    root.append(caption, plot.svg, note, fields, shapes, otherTitle, others, error);
    body.append(root);
    function update(next: EditorContext) {
      const previous = context;
      context = next;

      const s = signalState(context.doc, context.target.nodeId);
      caption.textContent =
        !('ok' in s) && s.low !== null && s.high !== null
          ? `${displayNumber(s.low)} to ${withUnit(s.high, info.unit)} · signal`
          : 'Sampled signal values';
      const { fromCycle: from, toCycle: to } = context.window;
      const points =
        context.events?.events
          .map((e) => ({
            t: e.whole?.[0] ?? e.part[0],
            v: (e.value as Record<string, unknown>)?.[
              String((context.target.node as { name?: string })?.name ?? context.target.control)
            ],
          }))
          .filter(
            (e): e is { t: number; v: number } =>
              e.t >= from && e.t < to && typeof e.v === 'number' && Number.isFinite(e.v),
          )
          .sort((a, b) => a.t - b.t) ?? [];
      const min = Math.min(('ok' in s ? null : s.low) ?? Infinity, ...points.map((p) => p.v)),
        max = Math.max(('ok' in s ? null : s.high) ?? -Infinity, ...points.map((p) => p.v));
      plot.path.setAttribute(
        'points',
        points
          .map(
            (p) =>
              `${(240 * (p.t - from)) / (to - from)},${95 - 90 * (max === min ? 0.5 : (p.v - min) / (max - min))}`,
          )
          .join(' '),
      );
      note.textContent = context.events?.error
        ? `Values unavailable: ${context.events.error.message}`
        : points.length
          ? `Real values · cycles ${from}–${to}`
          : 'No values in this window';
      if ('ok' in s) {
        error.textContent = s.reason;
        bounds.textContent = `Sampled low ${Number.isFinite(min) ? min : 'unavailable'} ${info.unit} · high ${Number.isFinite(max) ? max : 'unavailable'} ${info.unit}`;
        if (!bounds.isConnected) note.after(bounds);
        fields.hidden = tracks.hidden = shapes.hidden = true;
        return;
      }
      bounds.remove();
      fields.hidden = tracks.hidden = shapes.hidden = false;
      summary.textContent = `Shape · ${s.shape}`;
      const changed = previous.doc !== context.doc;
      [low, high, period].forEach((input, i) => {
        const value = [s.low, s.high, s.period][i];
        input.disabled = value === null;
        if (changed || document.activeElement !== input || context.pending === 'failed')
          input.value = value === null ? '' : String(value);
      });
      handles.forEach((h, i) => {
        const v = i === 0 ? s.low : s.high;
        h.disabled = v === null;
        h.style.left = `calc(${position(v ?? info.min) * 100}% - ${position(v ?? info.min) * 44}px)`;
        h.parentElement!.style.setProperty('--position', `${position(v ?? info.min) * 100}%`);
        h.setAttribute('aria-valuenow', String(v ?? info.min));
        h.setAttribute('aria-valuetext', withUnit(v ?? info.min, info.unit));
        h.title = `${i === 0 ? 'Low' : 'High'} ${withUnit(v ?? 'changing', info.unit)} · drag or use arrow keys`;
        h.setAttribute('aria-description', h.title);
      });
      buttons.forEach((b, i) =>
        b.setAttribute('aria-pressed', String(signalShapes[i] === s.shape)),
      );
      bounds.textContent = `Low ${withUnit(s.low ?? 'changing', info.unit)} · High ${withUnit(s.high ?? 'changing', info.unit)}`;
      others.replaceChildren(
        ...s.others.map((l) =>
          el(
            'li',
            l.kind === 'rewrite'
              ? `${l.name} · ${l.args.map((a) => (a.kind === 'literal' ? String(a.value) : 'changing value')).join(', ')}`
              : 'Source text layer',
          ),
        ),
      );
      otherTitle.hidden = others.hidden = !s.others.length;
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
