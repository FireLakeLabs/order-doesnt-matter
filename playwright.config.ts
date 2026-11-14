import { defineConfig } from '@playwright/test';
const optional = /\/(demo|edit-demo|shots|measure|online)\.spec\.ts$/;
const audio = /\/(engine|silent-swap)\.spec\.ts$/;
export default defineConfig({
  testDir: './tests/browser',
  // Bound concurrent score-worker queries; audio clocks run afterward.
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
    { name: 'default', testIgnore: [optional, audio] },
    { name: 'audio', testMatch: audio, workers: 1, dependencies: ['default'] },
    { name: 'optional', testMatch: optional },
  ],
});
