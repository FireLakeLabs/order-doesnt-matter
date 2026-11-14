import { createSpiral } from '../spiral';

export const previewMarkup = `
  <aside id="live-previews" aria-label="Live previews" hidden>
    <div id="now-slot"><section id="now-preview" class="live-preview" aria-label="Now preview">
      <header class="preview-toolbar"><button id="now-enlarge" aria-controls="preview-expanded" aria-expanded="false">Enlarge Now</button></header>
      <aside id="live" aria-label="Now"></aside>
    </section></div>
    <div id="watch-slot"><section id="watch-preview" class="live-preview" aria-label="Watch preview">
      <header class="preview-toolbar"><h2 id="watch-title">Watch</h2><button id="watch" aria-label="Watch" aria-controls="preview-expanded" aria-expanded="false" title="Enlarge Watch">Enlarge</button></header>
      <p id="watch-message" class="spiral-message" role="status"></p><div id="spiral"></div>
    </section></div>
  </aside>
  <dialog id="preview-expanded" class="preview-expanded"><button id="preview-close">Close</button></dialog>`;

/** Enlargement reparents the existing view; input, canvas and query state survive. */
export function createPreviews() {
  const get = (id: string) => document.getElementById(id)!;
  const dialog = get('preview-expanded') as HTMLDialogElement;
  const close = get('preview-close');
  const spiral = createSpiral(get('spiral'));
  let current: 'now' | 'watch' | null = null;
  function shrink(focus = true) {
    if (!current) return;
    const kind = current;
    current = null;
    get(`${kind}-slot`).append(get(`${kind}-preview`));
    const button = get(kind === 'now' ? 'now-enlarge' : 'watch');
    button.hidden = false;
    button.setAttribute('aria-expanded', 'false');
    dialog.close();
    // View controls collapse when returned to a small preview, retaining values.
    const controls =
      kind === 'watch' ? get('spiral').querySelector<HTMLDetailsElement>('.spiral-controls') : null;
    if (controls) controls.open = false;
    if (focus) button.focus();
  }
  for (const kind of ['now', 'watch'] as const) {
    const button = get(kind === 'now' ? 'now-enlarge' : 'watch');
    button.onclick = () => {
      shrink(false);
      current = kind;
      if (kind === 'now') get('live').querySelector('details')!.open = true;
      dialog.setAttribute('aria-labelledby', `${kind}-title`);
      dialog.append(get(`${kind}-preview`));
      button.hidden = true;
      button.setAttribute('aria-expanded', 'true');
      dialog.show();
      close.focus({ preventScroll: true });
      dialog.scrollIntoView({ block: 'nearest' });
    };
  }
  close.onclick = () => shrink();
  dialog.addEventListener('close', () => {
    if (!dialog.open) shrink();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    shrink();
  });
  return {
    spiral,
    escape() {
      if (!dialog.open || get('editor').contains(document.activeElement)) return false;
      shrink();
      return true;
    },
  };
}
