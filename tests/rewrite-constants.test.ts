import { afterAll, expect, it } from 'vitest';
import { instruments, type Doc, type RewriteLayer } from '../src/document';
import { sameOnsets } from '../src/document/edits/source-shared';
import { moveRewrite } from '../src/document/edits/rewrite-move';
import { rewriteChoices } from '../src/document/edits/rewrite-add';
import { generate } from '../src/generate';
import { importStrudel } from '../src/import';
import { queryEvents } from '../src/strudel/evaluate';

// D26 compares sorted onset multisets: whole spans and complete values.
// Keep the strict fragment comparison too: constants can split cycle boundaries.
const cases = [
  ['fast', [[2], [0.5], [1.5]], false],
  ['slow', [[3], [0.5], [1.5]], false],
  ['rev', [[]], true],
  ['palindrome', [[]], true],
  ['ply', [[3], [0.5], [1.5]], true],
  ['degradeBy', [[0], [0.4], [1]], true],
  ['early', [[0], [0.25], [-0.25]], false],
  ['late', [[0], [0.25], [-0.25]], false],
  [
    'euclid',
    [
      [3, 8],
      [5, 13],
      [0, 8],
    ],
    true,
  ],
  ['segment', [[1], [3], [2.5]], true],
] as const;
const settings = [
  ['lpf', '800'],
  ['gain', '.4'],
  ['pan', '.3'],
  ['room', '.2'],
  ['s', "'sine'"],
  ['n', '2'],
] as const;
const bases = [
  'note("60 ~ [64,67] 72@2")',
  'note("<60 62 65> [67 69]*3").slow(2)',
  'note("60? [62|65] ~ 67?0.4")',
  'note("60 62 65 67").sometimes(p=>p.ply(2)).degradeBy(.2)',
  'stack(note("60@3 ~"),note("~ 67*3")).early(.17)',
  'note("60 ~ 62").fast(1.5)',
  'note("60 ~ 62").slow(1.5)',
  'sine',
  'note("60 62").gain(".2 .6 .8")',
];
const onsetTable: Record<string, string>[] = [];
const fragmentTable: Record<string, string>[] = [];
afterAll(() => {
  console.log('D26 onset whole spans and complete values');
  console.table(onsetTable);
  console.log('Strict full events including part boundaries and non-onset fragments');
  console.table(fragmentTable);
});
it('the measurement covers the complete add list', () => {
  expect(cases.map(([name]) => name)).toEqual(rewriteChoices.map(({ name }) => name));
});
it.each(cases)(
  'D26 and strict commutation: %s × six constant settings, eight cycles',
  async (name, argumentsList, strictSafe) => {
    const row: Record<string, string> = { rewrite: name };
    const fragments: Record<string, string> = { rewrite: name };
    for (const [setting, value] of settings) {
      let identical = true;
      let sameFragments = true;
      for (const args of argumentsList)
        for (const base of bases) {
          const rewrite = `${name}(${args.join(',')})`;
          const a = await queryEvents(`${base}.${rewrite}.${setting}(${value})`, 0, 8);
          const b = await queryEvents(`${base}.${setting}(${value}).${rewrite}`, 0, 8);
          expect(a.error).toBeNull();
          expect(b.error).toBeNull();
          expect(a.opaqueValues).not.toBe(true);
          expect(b.opaqueValues).not.toBe(true);
          if (!sameOnsets(a, b)) {
            identical = false;
            console.log('D26 counterexample', { base, rewrite, setting, value, a, b });
          }
          // Strict diagnostic: order is immaterial; every serialized field counts.
          if (
            JSON.stringify(a.events.map((e) => JSON.stringify(e)).sort()) !==
            JSON.stringify(b.events.map((e) => JSON.stringify(e)).sort())
          )
            sameFragments = false;
        }
      row[setting] = identical ? 'equal' : 'DIFFERENT';
      fragments[setting] = sameFragments ? 'equal' : 'DIFFERENT';
      expect(identical, `D26 ${name}/${setting}`).toBe(true);
      expect(sameFragments, `strict ${name}/${setting}`).toBe(strictSafe);
    }
    onsetTable.push(row);
    fragmentTable.push(fragments);
  },
);
const load = (source: string) => importStrudel(source).doc;
const layers = (doc: Doc) => instruments(doc)[0].pattern.layers;
const rewrite = (doc: Doc) => layers(doc).find((l): l is RewriteLayer => l.kind === 'rewrite')!;
const accept = (result: ReturnType<typeof moveRewrite>): Doc => {
  if ('ok' in result) throw Error(result.reason);
  return result;
};
it.each(cases)(
  'moves proven %s across a whole constant bag and back, preserving events and neighbours',
  async (name, argumentsList) => {
    const doc = load(
      `const a=note("60? 62 ~ [65,67]").${name}(${argumentsList[0].join(',')}).lpf(800).gain(.4).pan(.3).room(.2).n(2); const b=note(72); stack(a,b)`,
    );
    const original = JSON.stringify(doc),
      layer = rewrite(doc),
      bag = layers(doc)[1];
    const next = accept(moveRewrite(doc, layer.id, 1));
    expect(layers(next)).toEqual([bag, layer]);
    expect(layers(next)[0]).toBe(bag);
    expect(next.body[1]).toBe(doc.body[1]);
    expect(accept(moveRewrite(next, layer.id, -1))).toEqual(doc);
    expect(JSON.stringify(doc)).toBe(original);
    const a = await queryEvents(generate(doc), 0, 8),
      b = await queryEvents(generate(next), 0, 8);
    expect(a.error).toBeNull();
    expect(sameOnsets(a, b)).toBe(true);
  },
);
it('refuses patterned, signal-driven, layered, muted, unproven and source barriers and pattern edges', () => {
  for (const source of [
    'note(60).rev().gain(".2 .4")',
    'note(60).rev().gain(sine)',
    'note(60).rev().gain(pure(.4).slow(2))',
    'note(60).rev().gain(.4).speed(.5)',
    'note(60).off(.5,p=>p.rev()).gain(.4)',
    'note(60).ply("<1 2>").gain(.4)',
    'note(60).rev()',
    'note(60).rev().scope()',
    'stack(note(60).rev(),note(72).gain(.4))',
  ]) {
    const doc = load(source);
    expect(moveRewrite(doc, rewrite(doc).id, 1), source).toMatchObject({ ok: false });
  }
  const doc = load('note(60).rev().gain(.4)');
  const bag = layers(doc)[1];
  if (bag.kind !== 'settings') throw Error('Expected settings');
  bag.settings[0].value.muted = true;
  expect(moveRewrite(doc, rewrite(doc).id, 1)).toMatchObject({ ok: false });
  layers(doc)[1] = { id: 'source', tier: 3, kind: 'opaque', code: '.unknown()' };
  expect(moveRewrite(doc, rewrite(doc).id, 1)).toMatchObject({ ok: false });
  expect(moveRewrite(doc, rewrite(doc).id, -1)).toMatchObject({ ok: false });
  expect(moveRewrite(doc, 'missing', 1)).toMatchObject({ ok: false });
});
it.each(cases)(
  'accepts %s with a plain constant sound but keeps mini notation and unproven arguments behind barriers',
  (name, args) => {
    const doc = load(`note(60).${name}(${args[0].join(',')}).s("sine")`);
    const bag = layers(doc)[1];
    if (bag.kind !== 'settings') throw Error('Expected settings');
    // Mini notation is a pattern even when it happens to contain one step.
    expect(moveRewrite(doc, rewrite(doc).id, 1)).toMatchObject({ ok: false });
    bag.settings[0].value.core = { kind: 'constant', value: 'sine' };
    expect(layers(accept(moveRewrite(doc, rewrite(doc).id, 1)))[0]).toBe(bag);
    rewrite(doc).args = [{ kind: 'opaque', code: 'custom' }];
    expect(moveRewrite(doc, rewrite(doc).id, 1)).toMatchObject({ ok: false });
  },
);
