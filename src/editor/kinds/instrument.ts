import type { EditorKind, EditorContext } from '../kind';
import { instruments, sections, walk, type Doc, type Pattern } from '../../document';
import { definitionMuted, setMuted } from '../../document/edits/set-muted';
import { setUseMuted } from '../../document/edits/set-use-muted';
import { renameInstrument } from '../../document/edits/rename-instrument';
import type { Refusal } from '../../document/edits/shared';
import { fieldLabel, toggle } from '../presentation';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
export default {
  id: 'instrument',
  priority: 10,
  matches: (target) => target.kind === 'instrument',
  mount(body, initial) {
    let context = initial,
      previousName = '',
      sectionKey = '';
    const form = el('form'),
      field = el('input'),
      label = fieldLabel('Instrument name', field);
    field.setAttribute('aria-label', 'Instrument name');
    const save = el('button', 'Rename'),
      error = el('p'),
      summary = el('div');
    const mute = toggle('Mute everywhere'),
      solo = toggle('Solo');
    const uses = el('div'),
      generated = el('small');
    body.classList.add('instrument-editor');
    error.setAttribute('role', 'alert');

    form.append(label, save, generated, error);
    generated.className = 'editor-helper';
    uses.className = 'editor-list';
    body.append(form, mute.label, solo.label, summary, uses);
    function apply(next: Doc | Refusal) {
      error.textContent = 'ok' in next ? next.reason : '';
      field.setAttribute('aria-invalid', String('ok' in next));
      if (!('ok' in next)) context.apply(next);
    }
    form.onsubmit = (event) => {
      event.preventDefault();
      apply(renameInstrument(context.doc, context.target.nodeId, field.value));
    };
    mute.input.onchange = () => {
      const row = instruments(context.doc).find((r) => r.id === context.target.nodeId)!;
      apply(setMuted(context.doc, row.id, !definitionMuted(context.doc, row.id)));
    };
    solo.input.onchange = () =>
      context.instrument?.setSolo(
        context.instrument.solo === context.target.nodeId ? null : context.target.nodeId,
      );
    function update(next: EditorContext) {
      context = next;
      const row = instruments(context.doc).find((r) => r.id === context.target.nodeId);
      if (!row) return;
      if (row.name !== previousName || document.activeElement !== field) field.value = row.name;
      previousName = row.name;
      generated.textContent =
        row.nameSource === 'generated' ? 'Generated name — rename it to make it yours' : '';
      mute.input.checked = definitionMuted(context.doc, row.id);
      solo.input.checked = context.instrument?.solo === row.id;
      solo.input.disabled = !context.instrument;
      const parts = sections(context.doc).filter((s) =>
        row.uses.some((u) => u.path.some((n) => n.id === s.id)),
      );
      const settings = new Set<string>(),
        rewrites = new Set<string>(),
        names = new Set<string>();
      walk(
        {
          version: 2,
          body: [
            {
              id: 'summary',
              tier: 1,
              kind: 'shared',
              nameSource: 'author',
              name: 'summary',
              pattern: row.pattern,
            },
          ],
        },
        (n) => {
          if ('name' in n && 'value' in n && ['s', 'sound'].includes(String(n.name))) {
            const value = (n as { value: Pattern }).value.core;
            const text =
              value.kind === 'constant'
                ? String(value.value)
                : value.kind === 'sequence'
                  ? value.notation
                  : '';
            text.match(/[a-zA-Z_][\w:.-]*/g)?.forEach((name) => names.add(name));
          }
          if (!('core' in n)) return;
          const core = (n as Pattern).core;
          if (core.kind === 'generator' && ['s', 'sound'].includes(core.name)) {
            const arg = core.args[0];
            const value = arg?.kind === 'pattern' ? arg.pattern.core : undefined;
            const text =
              arg?.kind === 'literal' && typeof arg.value === 'string'
                ? arg.value
                : value?.kind === 'sequence'
                  ? value.notation
                  : '';
            text.match(/[a-zA-Z_][\w:.-]*/g)?.forEach((name) => names.add(name));
          }
        },
      );
      for (const layer of [...row.pattern.layers, ...row.uses.flatMap((u) => u.layers)]) {
        if (layer.kind === 'settings') layer.settings.forEach((s) => settings.add(s.id));
        if (layer.kind === 'rewrite') rewrites.add(layer.id);
      }
      context.events?.events.forEach((e) => {
        const sound = (e.value as { s?: unknown })?.s;
        [sound].flat().forEach((s) => {
          if (typeof s === 'string') names.add(s);
        });
      });
      const sounds = [...names].map((name) => {
        const sound = context.instrument?.sounds.find(
          (s) => s.name === name || s.name === name.split(':')[0],
        );
        return `${name}: ${!sound || sound.state === 'not-loaded' ? 'not loaded yet' : sound.state}${sound?.detail ? ` — ${sound.detail}` : ''}`;
      });
      summary.replaceChildren();
      sounds.forEach((text) => {
        const item = el('p', text);
        item.className = text.includes(': missing') ? 'editor-error' : 'editor-helper';
        summary.append(item);
      });
      summary.append(
        el(
          'span',
          `${parts.length ? `${parts.filter((s) => s.instrumentIds.includes(row.id)).length} sections` : 'Across the piece'} · ${settings.size} settings · ${rewrites.size} rewrites`,
        ),
      );
      const key = JSON.stringify(parts.map((s) => [s.id, s.name]));
      if (key !== sectionKey) {
        sectionKey = key;
        uses.replaceChildren();
        if (parts.length > 1)
          parts.forEach((part) => {
            const repeated = parts.filter((s) => s.name === part.name).length > 1;
            const control = toggle(
              `Plays in ${part.name.replaceAll('$', '')}${repeated ? ` · cycles ${part.start}–${part.start + part.cycles}` : ''}`,
            );
            const button = control.input;
            button.dataset.useSection = part.id;
            button.onchange = () =>
              apply(setUseMuted(context.doc, row.id, part.id, !button.checked));
            uses.append(control.label);
          });
      }
      uses.querySelectorAll<HTMLInputElement>('input').forEach((button) => {
        const local = row.uses.filter((u) =>
          u.path.some((n) => n.id === button.dataset.useSection),
        );
        button.checked = local.some((u) => !u.muted);
      });
    }
    update(initial);
    return {
      update,
      destroy() {
        body.classList.remove('instrument-editor');
        body.replaceChildren();
      },
    };
  },
} satisfies EditorKind;
