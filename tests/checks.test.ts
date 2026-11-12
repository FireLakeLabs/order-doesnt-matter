import { expect, test } from 'vitest';
import { docBudgets, inspectDocs } from '../scripts/docs.mjs';
import { boundaryProblems } from '../scripts/boundaries.mjs';
import { timingResult, BROWSER_LIMIT_SECONDS, NODE_LIMIT_SECONDS } from '../scripts/timing.mjs';

test('document budgets detect missing and oversized living docs', () => {
  const read = (path: string) => (path === 'AGENTS.md' ? 'word '.repeat(401) : '');
  const rows = inspectDocs(read);
  expect(rows[0]).toMatchObject({ words: 401, limit: 400, ok: false });
  expect(
    inspectDocs(() => {
      throw Error('missing');
    }).every((r) => !r.ok),
  ).toBe(true);
  expect(inspectDocs(() => '').every((r) => r.ok)).toBe(true);
  expect(Object.keys(docBudgets)).toHaveLength(4);
});

test('boundary fixtures reject imports and fixed ports; allow the seam and OS ports', () => {
  for (const code of [
    "import '@strudel/core'",
    "export { x } from 'superdough'",
    "const x = import('@strudel/web')",
    "const x = require('@strudel/mini')",
  ]) {
    expect(boundaryProblems('src/document/bad.ts', code)).not.toEqual([]);
    expect(boundaryProblems('src/strudel/good.ts', code)).toEqual([]);
  }
  for (const path of ['src/app/bad.ts', 'tests/bad.test.ts'])
    expect(boundaryProblems(path, "import '../../spikes/document' ")).not.toEqual([]);
  for (const code of [
    'port: N',
    '--port N',
    'http://localhost:N',
    'listen(N)',
    '"port": N',
    'PORT = N',
  ].map((s) => s.replace('N', '44'.repeat(2))))
    expect(boundaryProblems('scripts/bad.mjs', code), code).not.toEqual([]);
  expect(boundaryProblems('vite.config.ts', 'port: 0')).toEqual([]);
});

test('browser timing includes the boundary and fails above it without sleeping', () => {
  expect(BROWSER_LIMIT_SECONDS).toBe(180);
  expect(timingResult(0, 180_000)).toMatchObject({ seconds: 180, ok: true });
  expect(timingResult(0, 180_001)).toMatchObject({ ok: false });
  expect(timingResult(10, 20, 0)).toMatchObject({ ok: false });
});

test('Node timing includes 60 seconds and rejects excess without sleeping', () => {
  expect(NODE_LIMIT_SECONDS).toBe(60);
  expect(timingResult(50, 60_050, NODE_LIMIT_SECONDS)).toEqual({ seconds: 60, ok: true });
  expect(timingResult(50, 60_051, NODE_LIMIT_SECONDS).ok).toBe(false);
});

test('browser growth guard keeps the 20 second boundary, ranks five and excludes skips', async () => {
  const { browserSummary, formatBrowserSummary } = await import('../scripts/browser-summary.mjs');
  const rows = [1000, 3000, 20000, 20001, 2, 4000, 100].map((ms, i) => ({
    title: `test ${i}`,
    ms,
    status: 'passed',
  }));
  const summary = browserSummary(
    [...rows, { title: 'optional', ms: 99999, status: 'skipped' }],
    70,
  );
  expect(summary.count).toBe(7);
  expect(summary.secondsPerTest).toBe(10);
  expect(summary.slowest.map((r) => r.ms)).toEqual([20001, 20000, 4000, 3000, 1000]);
  expect(summary.over.map((r) => r.title)).toEqual(['test 3']);
  expect(summary.ok).toBe(false);
  expect(formatBrowserSummary(summary)).toContain('OVER SINGLE-TEST BUDGET (20 s): test 3');
  expect(
    browserSummary(
      rows.filter((r) => r.ms <= 20000),
      1,
    ).ok,
  ).toBe(true);
  expect(browserSummary([], 10)).toMatchObject({ count: 0, secondsPerTest: 0, ok: true });
});

test('browser phase accounting includes poll gaps and unions nested/concurrent work', async () => {
  const { phaseTimings } = await import('../scripts/browser-report.mjs');
  const step = (title: string, startTime: number, duration: number, steps: unknown[] = []) => ({
    title,
    startTime,
    duration,
    steps,
  });
  const result = {
    startTime: 0,
    duration: 1000,
    steps: [
      step('ODM:playback', 0, 200, [step('ODM:swap', 10, 180)]),
      step('poll toBe', 200, 500, [step('Evaluate', 200, 5), step('Evaluate', 690, 5)]),
      step('After Hooks', 900, 100),
    ],
    attachments: [
      {
        name: 'browser-marks',
        body: Buffer.from(
          JSON.stringify({
            origin: 0,
            marks: [
              { name: 'swap', start: 720, end: 850 },
              { name: 'capture', start: 750, end: 800 },
              { name: 'capture', start: 775, end: 825 },
            ],
          }),
        ),
      },
    ],
  };
  expect(phaseTimings(result)).toEqual({
    page: 0,
    import: 0,
    playback: 200,
    observation: 500,
    swap: 55,
    capture: 75,
    teardown: 100,
    other: 70,
  });
});

test('shared setup is visible without adding it twice to command seconds per test', async () => {
  const { browserSummary, formatBrowserSummary } = await import('../scripts/browser-summary.mjs');
  const summary = browserSummary(
    [{ title: 'shared page', status: 'passed', ms: 2000, sharedSetupMs: 1500 }],
    5,
  );
  expect(summary.secondsPerTest).toBe(5);
  expect(summary.sharedSetup).toHaveLength(1);
  expect(formatBrowserSummary(summary)).toContain(
    'Reported shared setup (already in wall time): 1.500 s shared page',
  );
});

test('shared all-hook clock slots do not displace the actual test teardown timing', async () => {
  const { phaseTimings } = await import('../scripts/browser-report.mjs');
  const step = (title: string, startTime: number, duration: number, steps: unknown[] = []) => ({
    title,
    startTime,
    duration,
    steps,
  });
  const phases = phaseTimings({
    startTime: 0,
    duration: 1000,
    attachments: [],
    steps: [
      step('Before Hooks', 0, 500, [
        step('beforeAll hook', 0, 400, [step('Navigate to shared page', 0, 400)]),
      ]),
      step('ODM:swap', 500, 700),
      step('After Hooks', 1200, 200),
    ],
  });
  expect(phases).toEqual({
    page: 0,
    import: 0,
    playback: 0,
    swap: 700,
    observation: 0,
    capture: 0,
    teardown: 200,
    other: 100,
  });
});
