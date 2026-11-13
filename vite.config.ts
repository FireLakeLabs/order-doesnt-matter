import { readdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import { deployedCommit, licencePlugins } from './scripts/licenses';
const licences = licencePlugins();
// Every harness/*.html is built as its own page, so a browser test can load one
// part of the app (harness/engine.html, harness/sheet.html) without the others.
const harness = readdirSync('harness')
  .filter((name) => name.endsWith('.html'))
  .map((name) => `harness/${name}`);
export default defineConfig({
  define: { __BUILD_SHA__: JSON.stringify(deployedCommit()) },
  plugins: [licences.app()],
  worker: { plugins: () => [licences.worker()] },
  server: { port: 0 },
  preview: { port: 0 },
  build: { rollupOptions: { input: ['index.html', ...harness] } },
});
