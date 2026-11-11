import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("build", { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  outfile: "build/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
await build({
  entryPoints: ["src/browser-worker.mjs"],
  outfile: "build/browser-worker.mjs",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
// The Node branch of the bundle retains a file-based worker too.
for (const file of ["node-worker.mjs", "runtime.mjs"])
  await copyFile(`src/${file}`, `build/${file}`);
console.log("Built browser ESM + worker and retained Node worker adapter");
