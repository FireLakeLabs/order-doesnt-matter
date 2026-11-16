import type { EditorContext } from '../../editor/kind';
import { describeTarget } from '../../document/edit';
import type { StudioScore } from '../lanes/use-score';
import { runtime } from '../runtime';
import { session } from '../session';

export function editorContext(id: string | null, score: StudioScore): EditorContext | null {
  const { app } = runtime,
    doc = app.state.doc,
    editor = app.editor;
  if (!id || !doc || !editor) return null;
  const target = describeTarget(doc, id);
  if (!target.node) return null;
  const entry = Object.entries(editor.state.entries).find(([key]) => key === id)?.[1];
  return {
    doc,
    target,
    events: target.instrumentId ? score.events[target.instrumentId] : undefined,
    window: { fromCycle: score.from, toCycle: score.to },
    pending: entry?.status ?? 'none',
    instrument: {
      sounds: app.state.sounds,
      solo: app.state.solo,
      setSolo: (id) => {
        app.solo(id);
      },
    },
    apply(next, options) {
      editor.apply(next, { gesture: options?.gesture }, id);
      if (options?.selection !== undefined) {
        const nextId = options.selection;
        if (nextId && describeTarget(next, nextId).kind === 'instrument')
          session.selectInstrument(nextId);
        else session.openEditor(nextId);
      }
    },
    ask: (candidate, instrument) => editor.ask(candidate, instrument, score.from, score.to),
    submit: (work) => editor.submit(work),
  };
}

/** Source and argument editors address descendants of the same visible tile. */
export function pendingFor(id: string) {
  const entries = Object.entries(runtime.app.editor?.state.entries ?? {});
  return (
    entries.find(([key]) => key === id)?.[1] ??
    entries.find(([key]) => key.startsWith(`${id}:`))?.[1]
  );
}
