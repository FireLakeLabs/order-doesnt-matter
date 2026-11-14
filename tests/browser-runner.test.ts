import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import BrowserReport from '../scripts/browser-report.mjs';
import { killBrowserRun } from '../scripts/browser-process.mjs';

test('browser accounting survives interruption before onEnd with complete JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'odm-browser-report-'));
  const paths = [join(dir, 'timings.json'), join(dir, 'profile.json')];
  vi.stubEnv('ODM_REPORT_PATH', paths[0]);
  vi.stubEnv('ODM_PROFILE_PATH', paths[1]);
  try {
    const reporter = new BrowserReport();
    reporter.onBegin();
    for (const path of paths) expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([]);
    reporter.onTestEnd(
      { titlePath: () => ['canary'], location: { file: '/canary.spec.ts' } },
      { startTime: 0, duration: 42, steps: [], attachments: [], status: 'passed' },
    );
    // No onEnd: the wall guard may kill the runner during the next case.
    for (const path of paths) {
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject([
        { title: 'canary', status: 'passed', ms: 42, phases: { other: 42 } },
      ]);
      expect(existsSync(`${path}.tmp`)).toBe(false);
    }
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('browser deadline closes descendant writers before cleanup', async () => {
  // A CLI-only kill leaves this writer holding stdout open. Its group must die
  // too; waiting on close, not exit, proves the inherited pipe is no longer held.
  const writer = `console.log('writing'); setInterval(() => console.log('writing'), 10);`;
  const cli = `
    const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', ${JSON.stringify(writer)}], { stdio: ['ignore', 1, 2] });
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['-e', cli], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  try {
    await once(child.stdout, 'data');
    killBrowserRun(child);
    const [code, signal] = await closed;
    expect(code !== 0 || signal !== null).toBe(true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) killBrowserRun(child);
    await closed;
  }
}, 3_000);

test.skipIf(process.platform === 'win32')(
  'parent cancellation stops its detached browser run',
  async () => {
    const helper = new URL('../scripts/browser-process.mjs', import.meta.url).href;
    const fixture = `
    import {spawn} from 'node:child_process';
    import * as runner from ${JSON.stringify(helper)};
    const child=spawn(process.execPath,['-e',"console.log('ready');setInterval(()=>{},1000)"],{
      detached:true,stdio:['ignore','pipe','pipe']
    });
    const off=runner.forwardBrowserSignals?.(child);
    child.once('close',()=>off?.());
    child.stdout.once('data',()=>console.log(child.pid));
  `;
    const parent = spawn(process.execPath, ['--input-type=module', '-e', fixture], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closed = once(parent, 'close');
    let pid: number | undefined;
    try {
      const [ready] = await once(parent.stdout, 'data');
      pid = Number(String(ready).trim());
      expect(pid).toBeGreaterThan(0);
      parent.kill('SIGTERM');
      const [code, signal] = await closed;
      let alive = true;
      try {
        process.kill(pid!, 0);
      } catch {
        alive = false;
      }
      expect({ code, signal, alive }).toEqual({ code: 143, signal: null, alive: false });
    } finally {
      if (pid) killBrowserRun({ pid });
      if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
      await closed;
    }
  },
  3_000,
);
