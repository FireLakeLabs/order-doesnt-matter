import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  use: { browserName: 'chromium', baseURL: process.env.ODM_URL },
  reporter: 'line',
});
