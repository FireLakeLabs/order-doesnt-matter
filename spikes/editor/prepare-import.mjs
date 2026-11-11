import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
// Consume the concurrent spike without writing into it. JS boundary avoids imposing
// this study's noUncheckedIndexedAccess setting on its source tree.
await mkdir("vendor", { recursive: true });
await build({
  entryPoints: ["../import/src/index.ts"],
  outfile: "vendor/import.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  packages: "external",
});
await build({
  entryPoints: ["../import/src/browser-worker.mjs"],
  outfile: "vendor/browser-worker.mjs",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  packages: "external",
});
for (const file of ["node-worker.mjs", "runtime.mjs"])
  await copyFile(`../import/src/${file}`, `vendor/${file}`);
