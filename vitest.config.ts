import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    // Two files, each with a small query pool: bound CPU contention on CI.
    maxWorkers: 2,
    include: ['src/**/*.test.ts', 'tests/*.test.ts'],
    server: { deps: { inline: [/@strudel\//, /@kabelsalat\//] } },
  },
});
