import type { App } from './controller';

export const keepMarkup = `
  <section id="keep-panel" hidden aria-label="Keep work">
    <h2>Keep this version</h2>
    <p>Recovery keeps one latest document in this browser on this device. It can be cleared by your browser; download a portable copy too.</p>
    <p id="recovery-status" role="status"></p>
    <div class="load-actions"><button id="recover" hidden>Recover last work</button>
      <button id="download-document" disabled>Download document</button>
      <button id="export-strudel" disabled>Export Strudel</button>
      <button id="open-document">Open document</button>
      <input id="document-file" type="file" accept=".json,application/json" hidden>
    </div>
  </section>`;

export function mountKeep(app: App) {
  const get = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id)! as T;
  const dialog = document.createElement('dialog');
  dialog.className = 'about-dialog';
  dialog.setAttribute('aria-labelledby', 'replace-title');
  dialog.innerHTML = `<h2 id="replace-title">Replace current work?</h2>
    <p>This replaces your current score and Undo history, and the latest recovery on this device. Download your document first if you want to keep both.</p>
    <form method="dialog" class="load-actions"><button value="keep" autofocus>Keep current</button><button value="replace">Replace</button></form>`;
  document.body.append(dialog);
  const panel = get('keep-panel'),
    toggle = get('keep');
  toggle.onclick = () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  };
  if (app.retention.candidate || app.retention.notice.includes('could not')) {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  }
  function download(text: string | null, name: string, type: string) {
    if (text === null) return;
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  get('download-document').onclick = () =>
    download(
      app.downloadDocument(),
      app.practice ? 'odm-practice-kiln.json' : 'odm-document.json',
      'application/json',
    );
  get('export-strudel').onclick = () =>
    download(
      app.exportStrudel(),
      app.practice ? 'odm-practice-kiln.strudel' : 'odm-score.strudel',
      'text/plain',
    );
  get('recover').onclick = () => {
    void app.recover();
  };
  const file = get<HTMLInputElement>('document-file');
  get('open-document').onclick = () => file.click();
  file.onchange = async () => {
    const selected = file.files?.[0];
    file.value = '';
    if (!selected) return;
    const activation = app.activation;
    try {
      const text = await selected.text();
      if (activation !== app.activation) return;
      await app.openDocument(text);
    } catch {
      if (activation !== app.activation) return;
      get('load-error').textContent = 'Could not read this file. Your current work is still here.';
    }
  };
  app.subscribe(() => {
    if (app.retention.notice.includes('could not')) {
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    }
    get('download-document').textContent = app.practice
      ? 'Download practice document'
      : 'Download document';
    get('export-strudel').textContent = app.practice ? 'Export practice Strudel' : 'Export Strudel';
    get('recovery-status').textContent = app.retention.notice;
    get('recover').hidden = !app.retention.candidate;
    for (const id of ['download-document', 'export-strudel'])
      get<HTMLButtonElement>(id).disabled = !app.state.doc;
  });
  return {
    dialog,
    confirmReplacement() {
      if (dialog.open) return Promise.resolve(false);
      const origin = document.activeElement as HTMLElement | null;
      dialog.returnValue = 'keep';
      dialog.showModal();
      return new Promise<boolean>((resolve) =>
        dialog.addEventListener(
          'close',
          () => {
            origin?.focus({ preventScroll: true });
            resolve(dialog.returnValue === 'replace');
          },
          { once: true },
        ),
      );
    },
  };
}
