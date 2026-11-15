import { expect, it } from 'vitest';
import { describeTarget, setupSummary } from '../src/document/edit';
import type { Doc } from '../src/document';
import { importStrudel } from '../src/import';
import { sheetModel } from '../src/sheet/model';

const model = (doc: Doc) =>
  sheetModel({ doc, events: {}, sounds: [], fromCycle: 0, toCycle: 4, playhead: null });
it('setup entries keep document order, concise summaries and source selection breadcrumbs', () => {
  const codes = [
    'samples("github:example/drums")',
    'samples({ kick: "kick.wav" })',
    'function accent(p) { return p.gain(.5); }',
    'const helper = p => p.fast(2);',
    'register("custom", (x,p) => p.fast(x));',
    `unknownSetup(${JSON.stringify('x'.repeat(80))});`,
  ];
  const doc: Doc = {
    version: 2,
    body: codes.map((code, i) => ({ id: `setup-${i}`, kind: 'setup', tier: 3, code })),
  };
  const summaries = [
    'Loads sounds from github:example/drums',
    'Loads sounds from a sample map',
    'Defines helper: accent',
    'Defines helper: helper',
    'Setup source',
    'Setup source',
  ];
  expect(model(doc).setup).toEqual(
    summaries.map((summary, i) => ({ nodeId: `setup-${i}`, summary })),
  );
  for (const [i, summary] of summaries.entries()) {
    expect(describeTarget(doc, `setup-${i}`)).toMatchObject({
      kind: 'source',
      breadcrumb: ['setup', summary],
      generatedParts: [false, false],
    });
  }
});
it('setup is absent without entries or explicit tempo; last explicit tempo is read-only cpm', () => {
  expect(model({ version: 2, body: [] })).toMatchObject({ setup: [], tempo: null });
  const doc: Doc = {
    version: 2,
    body: [
      { id: 'first', kind: 'tempo', tier: 1, cpm: 90 },
      { id: 'last', kind: 'tempo', tier: 1, cpm: 123.5 },
    ],
  };
  expect(model(doc)).toMatchObject({ setup: [], tempo: '123.5 cycles per minute' });
});

it('labels parse leading comments and JS literals without altering stored source', () => {
  for (const [code, summary] of [
    [
      '// original note\n/* second */ await samples("https://example.test/a/*map*/");',
      'Loads sounds from https://example.test/a/*map*/',
    ],
    [
      '/* heading */ samples(`https://example.test/a//map`);',
      'Loads sounds from https://example.test/a//map',
    ],
    [
      '// heading\n samples(/* argument */ { kick: "//kick.wav" });',
      'Loads sounds from a sample map',
    ],
    ['/* heading */ async function accent(p) { return p; }\ns("bd")', 'Defines helper: accent'],
    ['// heading\nconst accent = /* helper */ async (p) => p; s("bd")', 'Defines helper: accent'],
    ['// misleading breadcrumb\nfor (let i=0;i<1;i++) s("bd")', 'Setup source'],
    ['/* only a comment */', 'Setup source'],
    ['samples(`bank/${name}`)', 'Setup source'],
    ['samples("unterminated)', 'Setup source'],
  ]) {
    expect(setupSummary(code)).toBe(summary);
    const doc: Doc = { version: 2, body: [{ id: 'setup', kind: 'setup', tier: 3, code }] };
    expect(model(doc).setup[0].summary).toBe(summary);
    expect(describeTarget(doc, 'setup').breadcrumb).toEqual(['setup', summary]);
    expect(doc.body[0]).toHaveProperty('code', code);
  }
});

it('ordinary comments before samples remain excluded from imported setup source', () => {
  const doc = importStrudel(
    '// Original sample note\nsamples({ kick: "//kick.wav" }); s("bd")',
  ).doc;
  expect(doc.body[0]).toMatchObject({ kind: 'setup', code: 'samples({ kick: "//kick.wav" });' });
  expect(model(doc).setup[0].summary).toBe('Loads sounds from a sample map');
});
