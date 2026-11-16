import { useLayoutEffect, useRef } from 'react';
import type { EditorContext, EditorKind } from '../../editor/kind';
import type { PendingEntry } from '../../editor/pending';
import { pendingWords } from '../../editor/pending';
import editorStyles from '../../editor/style.css?inline';
import { session } from '../session';
import { runtime } from '../runtime';
import { plainName } from './model';

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
  const body = useRef<HTMLDivElement>(null);
  const error = useRef<HTMLParagraphElement>(null);
  const mounted = useRef<{
    id: string;
    kind: EditorKind;
    handle: ReturnType<EditorKind['mount']>;
  } | null>(null);
  const kind = kindFor(context);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    let current = mounted.current;
    if (!current || current.id !== context.target.nodeId || current.kind !== kind) {
      if (error.current) error.current.textContent = '';
      current?.handle.destroy();
      el.replaceChildren();
      current = { id: context.target.nodeId, kind, handle: kind.mount(el, context) };
      mounted.current = current;
    } else current.handle.update(context);
  }, [context, kind]);
  useLayoutEffect(
    () => () => {
      mounted.current?.handle.destroy();
      mounted.current = null;
    },
    [],
  );
  const offers = editorKinds.flatMap(
    (kind) => kind.conversions?.(context.target, context.doc) ?? [],
  );
  return (
    <section
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
          › {plainName(context.target.control)}
        </h2>
        {context.target.kind !== 'source' && (
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
        <div className="editor-body" ref={body} />
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
