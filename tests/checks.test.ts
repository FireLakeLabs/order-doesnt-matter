import { expect, test } from 'vitest';
import { docPaths, inspectDocs } from '../scripts/docs.mjs';
import { boundaryProblems } from '../scripts/boundaries.mjs';
import {
  timingResult,
  formatTiming,
  BROWSER_WARN_SECONDS,
  NODE_WARN_SECONDS,
} from '../scripts/timing.mjs';

test('docs check keeps required files readable without word limits', () => {
  const read = (path: string) => (path === 'AGENTS.md' ? 'word '.repeat(10_000) : '');
  expect(inspectDocs(read).every((r) => r.ok)).toBe(true);
  expect(
    inspectDocs(() => {
      throw Error('missing');
    }).every((r) => !r.ok),
  ).toBe(true);
  expect(inspectDocs(() => '').every((r) => r.ok)).toBe(true);
  expect(docPaths).toHaveLength(4);
});

test('boundary fixtures reject imports and fixed ports; allow the seam and OS ports', () => {
  expect(
    boundaryProblems(
      'src/views/types.ts',
      "import type { SampleLookup } from '../strudel/sample-buffers'",
    ),
  ).toEqual([]);
  for (const code of [
    "import { createSampleLookup } from '../strudel/sample-buffers'",
    "import type { SampleLookup } from '../strudel/sample-cache'",
    "const cache = import('../strudel/sample-cache')",
  ])
    expect(boundaryProblems('src/views/bad.ts', code)).not.toEqual([]);
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
    '--portN',
    '--port=N',
    'http://localhost:N',
    'listen(N)',
    '"port": N',
    'PORT = N',
  ].map((s) => s.replace('N', '44'.repeat(2))))
    expect(boundaryProblems('scripts/bad.mjs', code), code).not.toEqual([]);
  expect(boundaryProblems('vite.config.ts', 'port: 0')).toEqual([]);
  for (const separator of [' ', '=', ''])
    expect(boundaryProblems('package.json', `vite --port${separator}${0}`)).not.toEqual([]);
});

test.each([
  ['Browser', BROWSER_WARN_SECONDS, 300],
  ['Node', NODE_WARN_SECONDS, 60],
] as const)('%s suite warns only above its informational threshold', (name, threshold, seconds) => {
  expect(threshold).toBe(seconds);
  const boundary = timingResult(50, seconds * 1000 + 50, threshold);
  expect(boundary).toEqual({ seconds, warning: false });
  expect(formatTiming(name, boundary, threshold)).not.toContain('WARNING');
  const over = timingResult(50, seconds * 1000 + 51, threshold);
  expect(over.warning).toBe(true);
  expect(formatTiming(name, over, threshold)).toContain(`WARNING: ${name} suite:`);
  expect(formatTiming(name, over, threshold)).toContain('exceeded (informational)');
});

test('browser accounting ranks five completed cases without a duration gate', async () => {
  const { browserSummary, formatBrowserSummary } = await import('../scripts/browser-summary.mjs');
  const rows = [1000, 3000, 25000, 25001, 20001, 4000, 100].map((ms, i) => ({
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
  expect(summary.slowest.map((r) => r.ms)).toEqual([25001, 25000, 20001, 4000, 3000]);
  expect(formatBrowserSummary(summary)).toContain('25.001 s test 3');
  expect(browserSummary([], 10)).toMatchObject({ count: 0, secondsPerTest: 0 });
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

test('all seven Strudel and superdough manifest and lock pins remain exact', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  for (const name of ['core', 'mini', 'tonal', 'transpiler', 'web', 'webaudio', 'superdough']) {
    const pkg = name === 'superdough' ? name : `@strudel/${name}`;
    const version = ['web', 'webaudio', 'superdough'].includes(name) ? '1.3.0' : '1.2.6';
    expect(manifest.dependencies[pkg]).toBe(version);
    expect(lock.packages[''].dependencies[pkg]).toBe(version);
    expect(lock.packages[`node_modules/${pkg}`].version).toBe(version);
  }
});

test('views import only sibling contracts or three; logic directories stay framework-free', () => {
  for (const name of ['react', '../engine', '../document', '../studio/runtime', '../lib/utils'])
    expect(boundaryProblems('src/views/bad.view.ts', `import '${name}'`)).toContain(
      'Views may import only views and three',
    );
  for (const name of ['./types', './nested/helper', 'three', 'three/addons/Thing.js'])
    expect(boundaryProblems('src/views/good.view.ts', `import '${name}'`)).toEqual([]);
  expect(boundaryProblems('src/views/nested/a.ts', "import '../../engine'")).not.toEqual([]);
  for (const directory of ['document', 'import', 'generate', 'engine', 'strudel'])
    for (const name of [
      'react',
      'react/jsx-runtime',
      'react-dom/client',
      '../studio/store',
      '../components/ui/button',
      '../views/types',
    ])
      expect(boundaryProblems(`src/${directory}/bad.ts`, `import '${name}'`)).toContain(
        'Logic directories must stay framework-free',
      );
});

test('only Staff may import the exact VexFlow package, including on-demand imports', () => {
  for (const path of ['src/views/staff.view.ts', 'src/views/staff/engrave.ts']) {
    expect(boundaryProblems(path, "const engraving = import('vexflow')")).toEqual([]);
    expect(boundaryProblems(path, "import type { Stave } from 'vexflow'")).toEqual([]);
    for (const name of ['vexflow/bravura', 'vexflow-extra', 'react'])
      expect(boundaryProblems(path, `import '${name}'`)).toContain(
        'Views may import only views and three',
      );
  }
  for (const path of [
    'src/views/other.view.ts',
    'src/views/other/draw.ts',
    'src/views/staff-extra/draw.ts',
  ])
    expect(boundaryProblems(path, "const engraving = import('vexflow')")).toContain(
      'Views may import only views and three',
    );
});
