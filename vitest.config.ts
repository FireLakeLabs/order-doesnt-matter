import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    // Worker-backed score proofs import Strudel afresh; slow CI runners need more than 5 s each.
    testTimeout: 30_000,
    include: ['src/**/*.test.ts', 'tests/*.test.ts'],
    server: { deps: { inline: [/@strudel\//, /@kabelsalat\//] } },
  },
});
