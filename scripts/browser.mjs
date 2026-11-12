import { mkdtempSync, rmSync, appendFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { browserSummary, formatBrowserSummary } from './browser-summary.mjs';
import { timingResult, BROWSER_LIMIT_SECONDS } from './timing.mjs';
const start = performance.now();
const mode = process.argv[2] ?? 'ci';
if (!['ci', 'online', 'demo', 'measure', 'edit-demo'].includes(mode))
  throw Error('Unknown browser mode');
// ODM_BROWSER_LIMIT_SECONDS is a lower-only override for exercising the failure path.
const limit = Number(process.env.ODM_BROWSER_LIMIT_SECONDS ?? BROWSER_LIMIT_SECONDS);
if (!Number.isFinite(limit) || limit < 0 || limit > BROWSER_LIMIT_SECONDS)
  throw Error('Invalid browser time limit');
const outDir = mkdtempSync('.browser-build-');
// Always retain the accounting reporter, including when the caller asks for JSON.
const args = process.argv.slice(3);
let reporters = 'line';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--reporter') reporters = args.splice(i--, 2)[1];
  else if (args[i].startsWith('--reporter=')) reporters = args.splice(i--, 1)[0].slice(11);
}
const reportPath = `${outDir}/timings.json`;
let server;
try {
  const { build, preview } = await import('vite');
  await build({ build: { outDir } });
  server = await preview({
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, open: false },
  });
  const address = server.httpServer.address();
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        'node_modules/@playwright/test/cli.js',
        'test',
        `--project=${mode === 'ci' ? 'audio' : 'optional'}`,
        ...(mode === 'ci' ? [] : [`tests/browser/${mode}.spec.ts`]),
        ...args,
        '--reporter',
        `${reporters},./scripts/browser-report.mjs`,
        '--output',
        `${outDir}/results`,
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          ODM_BROWSER_MODE: mode,
          ODM_REPORT_PATH: reportPath,
          ODM_URL: `http://127.0.0.1:${address.port}`,
        },
      },
    );
    const remaining = Math.max(0, limit * 1000 - (performance.now() - start));
    const timer = setTimeout(() => {
      console.error('Browser process exceeded wall budget');
      child.kill('SIGKILL');
    }, remaining);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
  if (code) process.exitCode = 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (server)
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  let rows;
  try {
    rows = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (error) {
    console.error('Missing browser timing report', error);
    process.exitCode = 1;
  }
  rmSync(outDir, { recursive: true, force: true });
  const result = timingResult(start, performance.now(), limit);
  const message = `Browser suite: ${result.seconds.toFixed(3)} s / ${limit} s — ${result.ok ? 'within budget' : 'OVER BUDGET'}`;
  if (rows) {
    const summary = browserSummary(rows, result.seconds);
    const report = formatBrowserSummary(summary);
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`text\n${report}\n\`\`\`\n`);
    if (mode === 'ci' && !summary.ok) process.exitCode = 1;
  }
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  if (!result.ok) process.exitCode = 1;
}
