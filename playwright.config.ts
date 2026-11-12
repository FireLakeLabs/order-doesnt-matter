import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  // Audio clocks and score workers compete for CPU. See tests/stability.md.
  // ODM_DEFAULT_WORKERS is only for the recorded 1/2/4/default comparison.
  workers: process.env.ODM_DEFAULT_WORKERS ? undefined : 2,
  use: { browserName: 'chromium', baseURL: process.env.ODM_URL },
  reporter: 'line',
});
