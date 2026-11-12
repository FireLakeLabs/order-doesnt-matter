// Reproducible local measurements. Logs/JSON live in ignored test-results/.
// Browser/Node stress stops at the first failure; the matrix records all three
// planned runs per worker count. Neither mode retries an individual test.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
const mode = process.argv[2];
if (!['matrix', 'browser', 'node'].includes(mode)) throw Error('Expected matrix, browser, or node');
const directory = `test-results/stability/${mode}`;
mkdirSync(directory, { recursive: true });
const rows = [];
const configurations = mode === 'matrix' ? ['1', '2', '4', 'default'] : ['configured'];
for (const workers of configurations) {
  for (let run = 1; run <= (mode === 'matrix' ? 3 : mode === 'browser' ? 15 : 10); run++) {
    const label = `${workers}-${run}`;
    const path = `${directory}/${label}.log`;
    const fd = openSync(path, 'w');
    const start = performance.now();
    const args =
      mode === 'node'
        ? ['test']
        : [
            'run',
            'test:browser',
            '--',
            'ci',
            '--reporter=line,json',
            ...(workers === 'configured' || workers === 'default' ? [] : [`--workers=${workers}`]),
          ];
    const code = await new Promise((resolve, reject) => {
      const child = spawn('npm', args, {
        stdio: ['ignore', fd, fd],
        env: {
          ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_NAME: `${directory}/${label}.json`,
          ...(workers === 'default' ? { ODM_DEFAULT_WORKERS: '1' } : {}),
        },
      });
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    closeSync(fd);
    const log = readFileSync(path, 'utf8');
    const timing = log.match(/(?:Node|Browser) suite: ([\d.]+) s/);
    const row = {
      workers,
      run,
      code,
      seconds: timing ? Number(timing[1]) : (performance.now() - start) / 1000,
    };
    rows.push(row);
    writeFileSync(`${directory}/runs.json`, JSON.stringify(rows, null, 2) + '\n');
    console.log(JSON.stringify(row));
    if (code) {
      process.exitCode = 1;
      if (mode !== 'matrix') break;
    }
  }
  if (process.exitCode && mode !== 'matrix') break;
}
