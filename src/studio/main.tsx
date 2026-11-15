import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/bricolage-grotesque/latin-400.css';
import '@fontsource/vt323/latin-400.css';
import '@fontsource/silkscreen/latin-400.css';
import './style.css';
import { Studio } from './Studio';
import { runtime, ready } from './runtime';

const root = document.getElementById('root');
if (!root) throw Error('Studio root is missing');
createRoot(root).render(
  <StrictMode>
    <Studio />
  </StrictMode>,
);
void ready;
// Same opt-in inspection convention as the existing page; no production test hooks.
if (new URLSearchParams(location.search).has('inspect'))
  Object.assign(window, { odmStudio: runtime });
declare global {
  interface Window {
    odmStudio: typeof runtime;
  }
}
