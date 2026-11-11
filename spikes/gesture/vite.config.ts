import { defineConfig } from 'vitest/config';
// The published @kabelsalat/web "main" points at an IIFE; its "module" is real ESM.
// Let Vite resolve that module in Node too. No Strudel modules are mocked.
export default defineConfig({ test: { server: { deps: { inline: [/@strudel\//, /@kabelsalat\//] } } } });
