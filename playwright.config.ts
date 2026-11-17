import { defineConfig } from '@playwright/test';
const optional = /\/online\.spec\.ts$/;
const engine = /\/(engine|silent-swap)\.spec\.ts$/;
const views = /\/view-[^/]+\.spec\.ts$/;
export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  retries: 0,
  // One audio clock workload at a time, including Studio transport checks.
  workers: 1,
  use: {
    browserName: 'chromium',
    baseURL: process.env.ODM_URL,
    // Per-file object overrides create distinct worker identities even when
    // their values match. Share this launch; each test still gets its own context.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  reporter: 'line',
  projects: [
    { name: 'studio', testMatch: /\.spec\.ts$/, testIgnore: [optional, engine, views] },
    { name: 'views', testMatch: views },
    { name: 'engine', testMatch: engine, workers: 1 },
    { name: 'optional', testMatch: optional },
    { name: 'measure-views', testMatch: /\/view-[^/]+\.measure\.ts$/, workers: 1 },
  ],
});
