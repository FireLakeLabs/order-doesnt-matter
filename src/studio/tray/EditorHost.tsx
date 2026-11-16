import { useLayoutEffect, useRef } from 'react';
import type { EditorContext, EditorKind } from '../../editor/kind';
import type { PendingEntry } from '../../editor/pending';
import { pendingWords } from '../../editor/pending';
import editorStyles from '../../editor/style.css?inline';
import { session } from '../session';
import { runtime } from '../runtime';
import { plainName } from './model';
import { editorFrozen, registerEditor, holdEditor, takeEditor, type MountedEditor } from './park';

// Inside @scope the panel root is addressed explicitly by :scope. Keep named
// descendants such as #editor-status intact. No declaration is changed.
const scopedEditorStyles = editorStyles.replace(/#editor(?![\w-])/g, ':scope');

export const editorKinds = Object.values(
  import.meta.glob<{ default: EditorKind }>('../../editor/kinds/*.ts', { eager: true }),
)
  .map((module) => module.default)
  .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
export function kindFor(context: EditorContext): EditorKind {
  const kind = editorKinds.find((kind) => kind.matches(context.target));
  if (!kind) throw Error('Editor fallback is not registered');
  return kind;
}

/** The body belongs solely to the imperative kind. Updates preserve mounted
 * forms; switching target/kind or closing destroys exactly that instance. */
export function EditorHost({
  context,
  name,
  entry,
  close,
}: {
  context: EditorContext;
  name: string;
  entry?: PendingEntry;
  close: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const error = useRef<HTMLParagraphElement>(null);
  const mounted = useRef<MountedEditor | null>(null);
  const live = useRef(false);
  const kind = kindFor(context);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || editorFrozen) return;
    let current = mounted.current;
    if (!current || current.id !== context.target.nodeId || current.kind !== kind) {
      if (error.current) error.current.textContent = '';
      current?.handle.destroy();
      el.replaceChildren();
      const held = takeEditor(context.target.nodeId, kind);
      const element = held?.element ?? document.createElement('div');
      element.classList.add('editor-body');
      el.append(element);
      current = held ?? {
        id: context.target.nodeId,
        kind,
        element,
        handle: kind.mount(element, context),
      };
      if (held) held.handle.update(context);
      mounted.current = current;
    } else current.handle.update(context);
  }, [context, kind]);
  useLayoutEffect(() => {
    live.current = true;
    const fence = (event: Event) => {
      if (editorFrozen) event.stopImmediatePropagation();
    };
    const host = root.current;
    host?.addEventListener('change', fence, true);
    host?.addEventListener('submit', fence, true);
    const unregister = registerEditor(() => {
      const current = mounted.current;
      if (!current) return;
      holdEditor(current);
      mounted.current = null;
    });
    return () => {
      unregister();
      host?.removeEventListener('change', fence, true);
      host?.removeEventListener('submit', fence, true);
      live.current = false;
      // React StrictMode replays effects before this microtask. Preserve the
      // same form on that replay; a real unmount still destroys it exactly once.
      queueMicrotask(() => {
        if (!live.current) {
          mounted.current?.handle.destroy();
          mounted.current = null;
        }
      });
    };
  }, []);
  const offers = editorKinds.flatMap(
    (kind) => kind.conversions?.(context.target, context.doc) ?? [],
  );
  return (
    <section
      ref={root}
      id="editor"
      className="studio-editor"
      data-layout={kind.layout ?? 'side'}
      data-editor-kind={kind.id}
      data-edit-state={entry?.status ?? ''}
    >
      {/* Reuse the existing stylesheet verbatim, scoped so its legacy page reset
        cannot reach the Studio shell. Kind-specific styles are imported by kinds. */}
      <style>{`@scope (#editor) { ${scopedEditorStyles} }`}</style>
      <header>
        <h2>
          <button className="tray-back" onClick={close}>
            {name}
          </button>{' '}
          ›{' '}
          {context.target.kind === 'section'
            ? context.target.section?.name
            : kind.id === 'section'
              ? 'Sections'
              : context.target.kind === 'instrument'
                ? 'Instrument'
                : plainName(context.target.control)}
        </h2>
        {context.target.node && context.target.kind !== 'source' && (
          <button
            onClick={() => {
              session.openEditor(
                `${context.target.nodeId.replace(/:(rhythm|rewrites)$/, '')}:source`,
              );
            }}
          >
            Edit as source
          </button>
        )}
      </header>
      <div className="studio-editor-scroll">
        <div className="editor-mount" ref={body} />
        {!!offers.length && (
          <div className="editor-conversions">
            <h3>Change to…</h3>
            {offers.map((offer) => (
              <button
                key={offer.label}
                onClick={() => {
                  const result = offer.apply();
                  if ('ok' in result) {
                    if (error.current) error.current.textContent = result.reason;
                  } else {
                    if (error.current) error.current.textContent = '';
                    context.apply(result);
                  }
                }}
              >
                {offer.label}
              </button>
            ))}
          </div>
        )}
        <p ref={error} className="editor-error" role="alert" />
      </div>
      <footer>
        <p id="editor-status" role="status">
          {entry?.status === 'failed'
            ? `Change failed: ${entry.reason ?? 'Previous value restored'}`
            : entry?.status === 'pending'
              ? pendingWords(entry)
              : runtime.app.state.playing
                ? 'Changed'
                : 'Plays on next start'}
        </p>
        <button className="editor-done" onClick={close}>
          Done
        </button>
      </footer>
    </section>
  );
}
