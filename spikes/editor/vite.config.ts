import { defineConfig } from "vitest/config";
// Resolve the published Kabelsalat ESM entry rather than its Node IIFE entry.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    server: { deps: { inline: [/@strudel\//, /@kabelsalat\//] } },
  },
});
