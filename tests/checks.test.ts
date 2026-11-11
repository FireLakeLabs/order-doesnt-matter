import { expect, test } from 'vitest';
import { docBudgets, inspectDocs } from '../scripts/docs.mjs';
import { boundaryProblems } from '../scripts/boundaries.mjs';
import { timingResult, BROWSER_LIMIT_SECONDS } from '../scripts/timing.mjs';

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
