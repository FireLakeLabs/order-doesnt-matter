import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { timingResult, NODE_LIMIT_SECONDS } from './timing.mjs';
const start = performance.now();
const limit = Number(process.env.ODM_NODE_LIMIT_SECONDS ?? NODE_LIMIT_SECONDS);
if (!Number.isFinite(limit) || limit < 0 || limit > NODE_LIMIT_SECONDS)
  throw Error('Invalid Node time limit');
const child = spawn(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
);
const timer = setTimeout(() => {
  console.error('Node process exceeded wall budget');
  child.kill('SIGKILL');
}, limit * 1000);
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('close', (code) => {
  clearTimeout(timer);
  const result = timingResult(start, performance.now(), limit);
  const message = `Node suite: ${result.seconds.toFixed(3)} s / ${limit} s — ${result.ok ? 'within budget' : 'OVER BUDGET'}`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  if (code !== 0 || !result.ok) process.exitCode = 1;
});
