import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
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
        ...(mode === 'ci' ? [] : [`tests/browser/${mode}.spec.ts`]),
        ...process.argv.slice(3),
        '--output',
        `${outDir}/results`,
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          ODM_BROWSER_MODE: mode,
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
  rmSync(outDir, { recursive: true, force: true });
  const result = timingResult(start, performance.now(), limit);
  const message = `Browser suite: ${result.seconds.toFixed(3)} s / ${limit} s — ${result.ok ? 'within budget' : 'OVER BUDGET'}`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  if (!result.ok) process.exitCode = 1;
}
