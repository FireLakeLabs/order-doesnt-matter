import { defineConfig } from '@playwright/test';
const optional = /\/(demo|edit-demo|shots|measure|online)\.spec\.ts$/;
const audio = /\/(engine|silent-swap)\.spec\.ts$/;
export default defineConfig({
  testDir: './tests/browser',
  // Bound concurrent score-worker queries; audio clocks run afterward.
  workers: 3,
  use: { browserName: 'chromium', baseURL: process.env.ODM_URL },
  reporter: 'line',
  projects: [
    { name: 'default', testIgnore: [optional, audio] },
    { name: 'audio', testMatch: audio, workers: 1, dependencies: ['default'] },
    { name: 'optional', testMatch: optional },
  ],
});
