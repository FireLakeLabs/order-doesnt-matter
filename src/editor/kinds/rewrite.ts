import type { EditorContext, EditorKind } from '../kind';
import type { Arg, Doc, Layer } from '../../document';
import { instruments, sections } from '../../document';
import { generatePattern } from '../../generate';
import { addRewrite, rewriteChoices } from '../../document/edits/rewrite-add';
import { setRewriteArgument } from '../../document/edits/rewrite-argument';
import { moveRewrite } from '../../document/edits/rewrite-move';
import { removeRewrite } from '../../document/edits/rewrite-remove';
import { rewriteOwner } from '../../document/edits/rewrite-shared';
import type { EventResult } from '../../contract';
import './rewrite.css';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
const descriptions: Record<string, string> = {
  ...Object.fromEntries(rewriteChoices.map((c) => [c.name, c.description])),
  off: 'Add a shifted copy of the score, changed by the callback.',
  every: 'Change the score with the callback every chosen number of cycles.',
  jux: 'Split the score left and right, changing one side with the callback.',
  euclidRot: 'Distribute pulses across steps, then rotate their positions.',
};
const names: Record<string, string[]> = {
  fast: ['Time factor'],
  slow: ['Time factor'],
  ply: ['Repeats per note'],
  degradeBy: ['Proportion left out'],
  early: ['Cycles earlier'],
  late: ['Cycles later'],
  euclid: ['Pulses', 'Steps'],
  euclidRot: ['Pulses', 'Steps', 'Rotation'],
  segment: ['Samples per cycle'],
  off: ['Shift in cycles', 'Changed copy'],
  every: ['Every how many cycles', 'Change'],
  jux: ['Change'],
};
function editable(arg: Arg): number | string | undefined {
  if (arg.kind === 'literal' && (typeof arg.value === 'number' || typeof arg.value === 'string'))
    return arg.value;
  if (arg.kind !== 'pattern' || arg.pattern.layers.length) return;
  const core = arg.pattern.core;
  return core.kind === 'sequence'
    ? core.notation
    : core.kind === 'constant' && typeof core.value !== 'boolean'
      ? core.value
      : undefined;
}
/** Actual scored spans, clipped to the current query window. Never an assumed grid. */
function strip(label: string, result: EventResult | undefined, context: EditorContext) {
  const figure = el('figure'),
    caption = el('figcaption', label);
  figure.append(caption);
  if (!result || result.error) {
    figure.append(
      el('p', result?.error ? `Broken: ${result.error.message}` : 'Notes not queried yet'),
    );
    return figure;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 240 40');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const { fromCycle: from, toCycle: to } = context.window;
  const events = result.events.filter((e) => e.part[0] < to && e.part[1] > from);
  const keys = [...new Set(events.map((e) => JSON.stringify(e.value)))];
  for (const event of events.slice(0, 200)) {
    const [a, b] = event.whole ?? event.part,
      rect = document.createElementNS(svg.namespaceURI, 'rect');
    rect.setAttribute('x', String(Math.max(0, ((a - from) / (to - from)) * 240)));
    rect.setAttribute(
      'width',
      String(Math.max(0.8, ((Math.min(to, b) - Math.max(from, a)) / (to - from)) * 240)),
    );
    rect.setAttribute('y', String(3 + (keys.indexOf(JSON.stringify(event.value)) % 5) * 7));
    rect.setAttribute('height', '5');
    svg.append(rect);
  }
  figure.append(
    svg,
    el(
      'small',
      `${events.length} event spans · cycles ${from}–${to}${events.length > 200 ? ' · first 200 drawn' : ''}`,
    ),
  );
  return figure;
}
export default {
  id: 'rewrite',
  priority: 10,
  matches: (target) => target.kind === 'rewrite',
  mount(body, initial) {
    let context = initial,
      rendered: Doc | undefined,
      formKey = '',
      previewKey = '',
      request = 0,
      destroyed = false;
    const root = el('div'),
      form = el('div'),
      previews = el('div'),
      error = el('p');
    root.className = 'rewrite-editor';
    error.setAttribute('role', 'alert');
    root.append(form, previews, error);
    body.append(root);
    function button(text: string, key: string, action: () => void) {
      const b = el('button', text);
      b.type = 'button';
      b.dataset.rewriteKey = key;
      b.onclick = action;
      return b;
    }
    function apply(
      next: Doc | { ok: false; reason: string },
      selection?: string,
      gesture?: string,
    ) {
      error.textContent = 'ok' in next ? next.reason : '';
      if (!('ok' in next)) context.apply(next, { selection, gesture });
    }
    function render() {
      const active = document.activeElement as HTMLElement | null,
        focusKey = active?.dataset.rewriteKey;
      form.replaceChildren();
      const owner = rewriteOwner(context.doc, context.target.nodeId),
        layer = owner?.layer;
      const row = instruments(context.doc).find((r) => r.id === context.target.instrumentId);
      if (!row) {
        form.append(el('p', 'This instrument no longer exists.'));
        return;
      }
      form.append(el('p', 'An ordered rewrite changes which notes exist and when. Order matters.'));
      if (layer) {
        form.append(
          el('h3', layer.name),
          el(
            'p',
            descriptions[layer.name] ??
              'Changes the score with this named rewrite; inspect its arguments below.',
          ),
        );
        layer.args.forEach((arg, index) => {
          const name = names[layer.name]?.[index] ?? `Argument ${index + 1}`,
            value = editable(arg);
          if (value === undefined) {
            const source =
              arg.kind === 'callback'
                ? `Changes in order: ${
                    arg.body.layers
                      .filter((l) => l.kind === 'rewrite')
                      .map((l) => l.name)
                      .join(', ') || 'a nested pattern'
                  }. Edited as source for now.`
                : arg.kind === 'opaque'
                  ? arg.code
                  : arg.kind === 'pattern'
                    ? generatePattern(arg.pattern)
                    : JSON.stringify(arg.value);
            form.append(el('p', `${name} · read-only`), el('pre', source));
            return;
          }
          const label = el('label', name),
            field = el('input');
          field.type = typeof value === 'number' ? 'number' : 'text';
          field.step = 'any';
          field.value = String(value);
          field.setAttribute('aria-label', name);
          field.dataset.rewriteKey = `arg-${index}`;
          const change = () => {
            if (field.value.trim() === '') {
              error.textContent = 'Enter a value before applying.';
              return;
            }
            apply(
              setRewriteArgument(
                context.doc,
                layer.id,
                index,
                field.type === 'number' ? field.valueAsNumber : field.value,
              ),
            );
          };
          field.onchange = change;
          field.onkeydown = (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              change();
            }
          };
          label.append(field);
          form.append(label);
          // A proportion has a defined range; arbitrary time factors have no invented slider limits.
          if (layer.name === 'degradeBy' && typeof value === 'number') {
            const slider = el('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '1';
            slider.step = '.01';
            slider.value = String(value);
            slider.setAttribute('aria-label', 'Proportion left out slider');
            slider.dataset.rewriteKey = 'proportion';
            let gesture: string | undefined;
            slider.onpointerdown = () => {
              gesture = `rewrite-drag-${performance.now()}`;
            };
            slider.onpointerup = slider.onpointercancel = () => {
              gesture = undefined;
            };
            slider.oninput = () =>
              apply(
                setRewriteArgument(context.doc, layer.id, index, slider.valueAsNumber),
                undefined,
                gesture,
              );
            form.append(slider);
          }
        });
        const actions = el('div');
        actions.className = 'rewrite-actions';
        for (const [text, direction] of [
          ['Move earlier', -1],
          ['Move later', 1],
        ] as const) {
          const move = button(text, text, () =>
            apply(moveRewrite(context.doc, layer.id, direction)),
          );
          const refusal = moveRewrite(context.doc, layer.id, direction);
          move.disabled = 'ok' in refusal;
          if ('ok' in refusal) move.title = refusal.reason;
          actions.append(move);
        }
        actions.append(
          button('Remove rewrite', 'remove', () =>
            apply(removeRewrite(context.doc, layer.id), `${row.pattern.id}:rewrites`),
          ),
        );
        form.append(
          actions,
          el(
            'small',
            'Only proven rewrites cross plain constant settings. Other settings can change the rhythm; source text and pattern boundaries stay barriers.',
          ),
        );
      }
      function ordered(title: string, layers: Layer[]) {
        const list = el('ol');
        list.setAttribute('aria-label', title);
        layers.forEach((l) => {
          if (l.kind !== 'rewrite') return;
          const item = el('li'),
            b = button(l.name, l.id, () => apply(context.doc, l.id));
          b.setAttribute('aria-label', `Edit ${l.name}`);
          if (l.id === layer?.id) b.setAttribute('aria-current', 'true');
          item.append(b);
          list.append(item);
        });
        if (list.children.length) form.append(el('h4', title), list);
      }
      ordered('Instrument rewrites, in order', row.pattern.layers);
      const seen = new Set<string>();
      for (const use of row.uses) {
        const extra = use.layers.filter((l) => l.kind === 'rewrite' && !seen.has(l.id));
        extra.forEach((l) => seen.add(l.id));
        const section = sections(context.doc).find((s) => use.path.some((p) => p.id === s.id));
        ordered(`After instrument rewrites · ${section?.name ?? 'piece'}`, extra);
      }
      if (owner && owner.pattern !== row.pattern && !seen.has(owner.layer.id))
        ordered('Inside this argument, in order', owner.pattern.layers);
      if (!layer) {
        form.append(el('h3', 'Add rewrite'));
        for (const choice of rewriteChoices) {
          const b = button(`Add ${choice.name}`, `add-${choice.name}`, () => {
            const next = addRewrite(context.doc, row.pattern.id, choice.name);
            const id =
              'ok' in next
                ? undefined
                : instruments(next)
                    .find((r) => r.id === row.id)!
                    .pattern.layers.at(-1)!.id;
            apply(next, id);
          });
          const label = el('div');
          label.className = 'rewrite-choice';
          label.append(b, el('small', choice.description));
          form.append(label);
        }
      }
      if (focusKey)
        Array.from(form.querySelectorAll<HTMLElement>('[data-rewrite-key]'))
          .find((n) => n.dataset.rewriteKey === focusKey)
          ?.focus({ preventScroll: true });
    }
    function update(next: EditorContext) {
      context = next;
      const layer = rewriteOwner(next.doc, next.target.nodeId)?.layer;
      const row = instruments(next.doc).find((r) => r.id === next.target.instrumentId);
      const keyForForm = JSON.stringify([
        row?.pattern.layers.map((l) => l.id),
        row?.uses.map((u) => u.layers.map((l) => l.id)),
        layer?.args.map((a) => [a.kind, typeof editable(a)]),
      ]);
      if (keyForForm !== formKey) {
        formKey = keyForForm;
        render();
      } else if (rendered !== next.doc && layer) {
        layer.args.forEach((arg, index) => {
          const value = editable(arg);
          const field = form.querySelector<HTMLInputElement>(`[data-rewrite-key="arg-${index}"]`);
          if (field && value !== undefined) field.value = String(value);
          const slider = form.querySelector<HTMLInputElement>('[data-rewrite-key="proportion"]');
          if (slider && typeof value === 'number') slider.value = String(value);
        });
      }
      rendered = next.doc;
      if (!layer) {
        previews.replaceChildren();
        return;
      }
      // Document and window key the preview, so status ticks cannot launch more workers.
      const key = JSON.stringify([next.doc, next.window]);
      if (key !== previewKey) {
        previewKey = key;
        const version = ++request;
        previews.replaceChildren(strip('With this rewrite', next.events, next));
        if (next.ask && next.target.instrumentId) {
          const without = removeRewrite(next.doc, layer.id);
          if (!('ok' in without)) {
            const waiting = el('p', 'Asking about notes without this rewrite…');
            previews.prepend(waiting);
            void next
              .ask(without, next.target.instrumentId)
              .then((result) => {
                if (destroyed || version !== request) return;
                waiting.replaceWith(strip('Without this rewrite', result, context));
              })
              .catch((e) => {
                if (!destroyed && version === request) waiting.textContent = `Broken: ${String(e)}`;
              });
          }
        } else
          previews.prepend(
            el('p', 'The comparison is unavailable here; showing the current score only.'),
          );
      } else {
        previews
          .querySelector('figure:last-child')
          ?.replaceWith(strip('With this rewrite', next.events, next));
      }
    }
    update(initial);
    return {
      update,
      destroy() {
        destroyed = true;
        ++request;
        root.remove();
      },
    };
  },
} satisfies EditorKind;
