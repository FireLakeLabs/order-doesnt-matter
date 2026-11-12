import { defineConfig } from '@playwright/test';
const optional = /\/(demo|edit-demo|shots|measure|online)\.spec\.ts$/;
export default defineConfig({
  testDir: './tests/browser',
  // Increase only after the local-load and CI matrix in tests/stability.md.
  workers: 3,
  use: { browserName: 'chromium', baseURL: process.env.ODM_URL },
  reporter: 'line',
  projects: [
    { name: 'default', testIgnore: optional },
    { name: 'optional', testMatch: optional },
  ],
});
