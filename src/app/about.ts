import strudelLogo from './assets/strudel.svg?url';

declare const __BUILD_SHA__: string | null;
export const buildSha = __BUILD_SHA__;
const repository = 'https://github.com/FireLakeLabs/order-doesnt-matter';
const external = 'target="_blank" rel="noopener"';

export const aboutControls = `
  <nav class="about-links" aria-label="About and source">
    <button id="about" aria-haspopup="dialog" aria-controls="about-dialog">About</button>
    <a class="icon-link" href="${repository}" ${external} aria-label="Source on GitHub" title="Source on GitHub">
      <svg aria-hidden="true" fill="currentColor" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>
    </a>
    <a class="icon-link" href="https://strudel.cc" ${external} aria-label="Strudel" title="Strudel"><img src="${strudelLogo}" alt="" width="17" height="17"></a>
  </nav>`;

export function mountAbout() {
  const trigger = document.getElementById('about')!;
  const dialog = document.createElement('dialog');
  dialog.id = 'about-dialog';
  dialog.className = 'about-dialog';
  dialog.setAttribute('aria-labelledby', 'about-title');
  dialog.innerHTML = `
    <h2 id="about-title">About Order Doesn't Matter</h2>
    <p>A visual instrument for Strudel. Read and edit a program's score, and follow its cycles.</p>
    <p>Made by Fire Lake Labs. Our own source code is MIT licensed. This app includes
    Strudel and other software under AGPL-3.0-or-later and other licences.
    The app as distributed is provided under the AGPL terms. You may use, share and
    modify it under those terms. It comes with no warranty.</p>
    <p><a href="${repository}/tree/${buildSha ?? 'main'}" ${external}>Source for this version</a>
    ${buildSha ? `<small>Commit ${buildSha}</small>` : '<small>Build commit unavailable; this link opens the main branch.</small>'}</p>
    <p><a href="/licenses.txt" ${external}>Full licence texts and third-party notices</a></p>
    <p>Strudel's corresponding source for our pinned versions:</p>
    <ul>${[
      ['core', '1.2.6'],
      ['mini', '1.2.6'],
      ['tonal', '1.2.6'],
      ['transpiler', '1.2.6'],
      ['web', '1.3.0'],
      ['webaudio', '1.3.0'],
      ['superdough', '1.3.0'],
    ]
      .map(([name, version]) => {
        const tag = `${name === 'superdough' ? name : `@strudel/${name}`}@${version}`;
        return `<li><a href="https://codeberg.org/uzu/strudel/src/tag/${encodeURIComponent(tag)}" ${external}>${tag}</a></li>`;
      })
      .join('')}</ul>
    <form method="dialog"><button autofocus>Close</button></form>`;
  document.body.append(dialog);
  trigger.onclick = () => dialog.showModal();
  dialog.addEventListener('close', () => trigger.focus({ preventScroll: true }));
  return dialog;
}
