import { defineConfig } from "vitest/config";
// Resolve the published Kabelsalat ESM entry rather than its Node IIFE entry.
import {localSourcePlugin} from "./local-source.mjs";
export default defineConfig({
  plugins:[localSourcePlugin()],
  test: {
    include: ["src/**/*.test.ts"],
    server: { deps: { inline: [/@strudel\//, /@kabelsalat\//] } },
  },
});
