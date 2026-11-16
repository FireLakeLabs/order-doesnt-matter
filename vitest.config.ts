import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 60_000,
    retry: 0,
    // Two files, each with a small query pool: bound CPU contention on CI.
    maxWorkers: 2,
    include: ['src/**/*.test.ts', 'tests/*.test.ts', 'tests/views/**/*.test.ts'],
    server: { deps: { inline: [/@strudel\//, /@kabelsalat\//] } },
  },
});
