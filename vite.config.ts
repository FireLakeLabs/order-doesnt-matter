import { readdirSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { deployedCommit, licencePlugins } from './scripts/licenses';
const licences = licencePlugins();
// Build the shared engine harness separately from the Studio.
const harness = readdirSync('harness')
  .filter((name) => name.endsWith('.html'))
  .map((name) => `harness/${name}`);
export default defineConfig({
  define: { __BUILD_SHA__: JSON.stringify(deployedCommit()) },
  plugins: [react(), tailwindcss(), licences.app()],
  worker: { plugins: () => [licences.worker()] },
  server: { port: 0 },
  preview: { port: 0 },
  build: { rollupOptions: { input: ['index.html', 'studio.html', ...harness] } },
});
