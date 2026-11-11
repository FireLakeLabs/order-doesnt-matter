import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const start = performance.now(),
  runs = [];
for (const script of [
  "verify-real.mjs",
  "browser-test.mjs",
  "pointer-check.mjs",
  "corpus-audit.mjs",
]) {
  const began = performance.now(),
    remaining = 90000 - (began - start);
  if (remaining <= 0) throw Error("Browser suite exceeded 90 seconds");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      stdio: "inherit",
      env: { ...process.env, PASS: "study02" },
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(Error("Browser suite exceeded 90 seconds"));
    }, remaining);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error(`${script} exited ${code}`));
    });
  });
  runs.push({ script, durationMs: performance.now() - began });
}
const result = { durationMs: performance.now() - start, runs };
writeFileSync(
  "browser-suite-study02.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
