import { afterAll, expect, it } from 'vitest';
import { instruments, type Doc, type RewriteLayer } from '../src/document';
import { moveRewrite } from '../src/document/edits/rewrite-move';
import { rewriteChoices } from '../src/document/edits/rewrite-add';
import { generate } from '../src/generate';
import { importStrudel } from '../src/import';
import { queryEvents } from '../src/strudel/evaluate';

// Event identity includes whole/part spans and fragments, not just onset values.
// Constants introduce cycle boundaries: integer-only factors can hide a counterexample.
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
const table: Record<string, string>[] = [];
afterAll(() => console.table(table));
it('the measurement covers the complete add list', () => {
  expect(cases.map(([name]) => name)).toEqual(rewriteChoices.map(({ name }) => name));
});
it.each(cases)(
  'real Strudel commutation: %s × six constant settings, eight cycles',
  async (name, argumentsList, safe) => {
    const row: Record<string, string> = { rewrite: name };
    for (const [setting, value] of settings) {
      let identical = true;
      for (const args of argumentsList)
        for (const base of bases) {
          const rewrite = `${name}(${args.join(',')})`;
          const a = await queryEvents(`${base}.${rewrite}.${setting}(${value})`, 0, 8);
          const b = await queryEvents(`${base}.${setting}(${value}).${rewrite}`, 0, 8);
          expect(a.error).toBeNull();
          expect(b.error).toBeNull();
          // Order in a polyphonic query is immaterial; every event field still counts.
          if (
            JSON.stringify(a.events.map((e) => JSON.stringify(e)).sort()) !==
            JSON.stringify(b.events.map((e) => JSON.stringify(e)).sort())
          )
            identical = false;
        }
      row[setting] = identical ? 'equal' : 'DIFFERENT';
      expect(identical, `${name}/${setting}`).toBe(safe);
    }
    table.push(row);
  },
);
const load = (source: string) => importStrudel(source).doc;
const layers = (doc: Doc) => instruments(doc)[0].pattern.layers;
const rewrite = (doc: Doc) => layers(doc).find((l): l is RewriteLayer => l.kind === 'rewrite')!;
const accept = (result: ReturnType<typeof moveRewrite>): Doc => {
  if ('ok' in result) throw Error(result.reason);
  return result;
};
it.each(cases.filter(([, , safe]) => safe))(
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
    expect(b).toEqual(a);
  },
);
it('refuses patterned, signal-driven, layered, muted, unproven and source barriers and pattern edges', () => {
  for (const source of [
    'note(60).rev().gain(".2 .4")',
    'note(60).rev().gain(sine)',
    'note(60).rev().gain(pure(.4).slow(2))',
    'note(60).rev().gain(.4).speed(.5)',
    'note(60).fast(2).gain(.4)',
    'note(60).slow(1.5).gain(.4)',
    'note(60).early(.25).gain(.4)',
    'note(60).late(.25).gain(.4)',
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
it('accepts a plain constant sound but keeps mini notation and unproven arguments behind barriers', () => {
  const doc = load('note(60).rev().s("sine")');
  const bag = layers(doc)[1];
  if (bag.kind !== 'settings') throw Error('Expected settings');
  // Mini notation is a pattern even when it happens to contain one step.
  expect(moveRewrite(doc, rewrite(doc).id, 1)).toMatchObject({ ok: false });
  bag.settings[0].value.core = { kind: 'constant', value: 'sine' };
  expect(layers(accept(moveRewrite(doc, rewrite(doc).id, 1)))[0]).toBe(bag);
  rewrite(doc).args = [{ kind: 'opaque', code: 'custom' }];
  expect(moveRewrite(doc, rewrite(doc).id, 1)).toMatchObject({ ok: false });
});
