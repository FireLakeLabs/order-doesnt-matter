import { defineConfig } from '@playwright/test';
const optional = /\/(demo|edit-demo|shots|measure|online)\.spec\.ts$/;
const audio = /\/(engine|silent-swap)\.spec\.ts$/;
const delivery = /@audio-delivery/;
const studio = /\/(studio[^/]*|view-[^/]+)\.spec\.ts$/;
export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  retries: 0,
  // Keep the existing concurrency; CI gives each page its own runner.
  workers: 3,
  use: {
    browserName: 'chromium',
    baseURL: process.env.ODM_URL,
    // Per-file object overrides create distinct worker identities even when
    // their values match. Share this launch; each test still gets its own context.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  reporter: 'line',
  projects: [
    { name: 'default', testIgnore: [optional, audio, studio], grepInvert: delivery },
    {
      name: 'audio',
      testMatch: [audio, /\/rewrite\.spec\.ts$/],
      grep: [/(engine|silent-swap)\.spec\.ts/, delivery],
      workers: 1,
      dependencies: ['default'],
    },
    {
      name: 'studio',
      testMatch: studio,
      // The complete local command runs both pages without overlapping their clocks.
      dependencies: process.env.ODM_BROWSER_MODE === 'ci' ? ['audio'] : [],
    },
    { name: 'optional', testMatch: optional },
    { name: 'measure-views', testMatch: /\/view-[^/]+\.measure\.ts$/ },
  ],
});
