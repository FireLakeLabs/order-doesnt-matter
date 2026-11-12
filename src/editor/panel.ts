import type { PendingEntry } from './pending';
import type { EditorContext, EditorKind } from './kind';
import './style.css';
// A new default-exported kind file is the entire registration step.
const kinds = Object.values(
  import.meta.glob<{ default: EditorKind }>('./kinds/*.ts', { eager: true }),
)
  .map((module) => module.default)
  .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
export function createPanel(host: HTMLElement, close: () => void) {
  let id = '',
    active: EditorKind | undefined;
  let mounted: ReturnType<EditorKind['mount']> | undefined;
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
  return (context: EditorContext | null, entry: PendingEntry | undefined, playing: boolean) => {
    host.hidden = !context;
    if (!context) {
      mounted?.destroy();
      mounted = undefined;
      active = undefined;
      id = '';
      return;
    }
    const next = context.target;
    heading.replaceChildren();
    next.breadcrumb.forEach((part, i) => {
      if (i) heading.append(document.createTextNode(' › '));
      heading.append(el(next.generatedParts[i] ? 'em' : 'span', part));
    });
    if (next.generatedParts.some(Boolean)) {
      const alt = el('span', ' (generated name)');
      alt.className = 'sheet-sr-only';
      heading.append(alt);
    }
    const kind = kinds.find((kind) => kind.matches(next))!;
    if (id !== next.nodeId || active !== kind) {
      mounted?.destroy();
      body.replaceChildren();
      id = next.nodeId;
      active = kind;
      host.dataset.editorKind = kind.id;
      mounted = kind.mount(body, context);
    } else mounted!.update(context);
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
