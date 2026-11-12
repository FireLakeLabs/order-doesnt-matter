import { defineConfig } from '@playwright/test';
const optional = /\/(demo|edit-demo|shots|measure|online)\.spec\.ts$/;
const audio = /\/(engine|silent-swap)\.spec\.ts$/;
export default defineConfig({
  testDir: './tests/browser',
  // UI width is measured at 3/4; audio clocks get a separate uncontended phase.
  workers: 4,
  use: { browserName: 'chromium', baseURL: process.env.ODM_URL },
  reporter: 'line',
  projects: [
    { name: 'default', testIgnore: [optional, audio] },
    { name: 'audio', testMatch: audio, workers: 1, dependencies: ['default'] },
    { name: 'optional', testMatch: optional },
  ],
});
