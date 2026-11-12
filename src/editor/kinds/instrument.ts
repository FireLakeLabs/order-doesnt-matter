import type { EditorKind, EditorContext } from '../kind';
import { instruments, sections, walk, type Doc, type Pattern } from '../../document';
import { definitionMuted, setMuted } from '../../document/edits/set-muted';
import { setUseMuted } from '../../document/edits/set-use-muted';
import { renameInstrument } from '../../document/edits/rename-instrument';
import type { Refusal } from '../../document/edits/shared';
import './instrument.css';
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
      label = el('label', 'Instrument name'),
      field = el('input');
    field.setAttribute('aria-label', 'Instrument name');
    const save = el('button', 'Rename'),
      error = el('p'),
      summary = el('p');
    const mute = el('button', 'Mute everywhere'),
      solo = el('button', 'Solo');
    const uses = el('div'),
      generated = el('small');
    body.classList.add('instrument-editor');
    error.setAttribute('role', 'alert');
    label.append(field);
    form.append(label, save, generated, error);
    body.append(form, mute, solo, summary, uses);
    function apply(next: Doc | Refusal) {
      error.textContent = 'ok' in next ? next.reason : '';
      field.setAttribute('aria-invalid', String('ok' in next));
      if (!('ok' in next)) context.apply(next);
    }
    form.onsubmit = (event) => {
      event.preventDefault();
      apply(renameInstrument(context.doc, context.target.nodeId, field.value));
    };
    mute.type = solo.type = 'button';
    mute.onclick = () => {
      const row = instruments(context.doc).find((r) => r.id === context.target.nodeId)!;
      apply(setMuted(context.doc, row.id, !definitionMuted(context.doc, row.id)));
    };
    solo.onclick = () =>
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
      mute.setAttribute('aria-pressed', String(definitionMuted(context.doc, row.id)));
      solo.setAttribute('aria-pressed', String(context.instrument?.solo === row.id));
      solo.disabled = !context.instrument;
      const parts = sections(context.doc).filter((s) =>
        row.uses.some((u) => u.path.some((n) => n.id === s.id)),
      );
      const settings = new Set<string>(),
        rewrites = new Set<string>(),
        names = new Set<string>();
      walk(
        {
          version: 1,
          body: [{ id: 'summary', tier: 1, kind: 'shared', name: 'summary', pattern: row.pattern }],
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
      summary.textContent = `${sounds.join('; ') || 'Sound not queried'}. ${parts.length ? `Plays in ${parts.filter((s) => s.instrumentIds.includes(row.id)).length} of ${parts.length} sections` : 'Plays across the piece'}. ${settings.size} settings · ${rewrites.size} rewrites.`;
      const key = JSON.stringify(parts.map((s) => [s.id, s.name]));
      if (key !== sectionKey) {
        sectionKey = key;
        uses.replaceChildren();
        if (parts.length > 1)
          parts.forEach((part) => {
            const repeated = parts.filter((s) => s.name === part.name).length > 1;
            const button = el(
              'button',
              `Plays in ${part.name.replaceAll('$', '')}${repeated ? ` · cycles ${part.start}–${part.start + part.cycles}` : ''}`,
            );
            button.type = 'button';
            button.dataset.useSection = part.id;
            button.onclick = () =>
              apply(
                setUseMuted(
                  context.doc,
                  row.id,
                  part.id,
                  button.getAttribute('aria-pressed') === 'true',
                ),
              );
            uses.append(button);
          });
      }
      uses.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        const local = row.uses.filter((u) =>
          u.path.some((n) => n.id === button.dataset.useSection),
        );
        button.setAttribute('aria-pressed', String(local.some((u) => !u.muted)));
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
