import { expect, it } from 'vitest';
import { describeTarget } from '../src/document/edit';
import type { Doc } from '../src/document';
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
    codes[4],
    codes[5].slice(0, 60),
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
