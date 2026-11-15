import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { timingResult, formatTiming, NODE_WARN_SECONDS } from './timing.mjs';
const start = performance.now();
const child = spawn(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
);
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('close', (code) => {
  const result = timingResult(start, performance.now(), NODE_WARN_SECONDS);
  const message = formatTiming('Node', result, NODE_WARN_SECONDS);
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  if (code !== 0) process.exitCode = 1;
});
