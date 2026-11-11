import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const start = performance.now(),
  runs = [],
  running = new Set();
async function run(script, env = {}, label = script) {
  const began = performance.now(),
    remaining = 90000 - (began - start);
  if (remaining <= 0) throw Error("Browser suite exceeded 90 seconds");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      stdio: "inherit",
      env: { ...process.env, PASS: "study02", ...env },
    });
    running.add(child);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(Error("Browser suite exceeded 90 seconds"));
    }, remaining);
    child.on("error", (error) => {
      clearTimeout(timer);
      running.delete(child);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      running.delete(child);
      code === 0 ? resolve() : reject(Error(`${label} exited ${code}`));
    });
  });
  runs.push({ script: label, durationMs: performance.now() - began });
}
// Pure Node corpus queries are independent of the browser's UI checks. Finish
// writing their input before the browser resolves the default sound registry.
const audit = run("sound-audit.mjs").then(
  () => undefined,
  (error) => error,
);
try {
  for (const script of [
    "verify-real.mjs",
    "browser-test.mjs",
    "pointer-check.mjs",
    "corpus-audit.mjs",
  ])
    await run(script);
  const error = await audit;
  if (error) throw error;
  await run("owner-browser.mjs");
  await run("owner-regressions.mjs");
  await run(
    "owner-browser.mjs",
    { OFFLINE: "1" },
    "owner-browser.mjs (offline)",
  );
  const result = { durationMs: performance.now() - start, runs };
  writeFileSync(
    "browser-suite-study02.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  for (const child of running) child.kill("SIGTERM");
}
