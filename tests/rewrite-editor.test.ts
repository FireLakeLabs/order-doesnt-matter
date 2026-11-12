import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { checkDoc, instruments, type Doc, type RewriteLayer } from '../src/document';
import { describeTarget } from '../src/document/edit';
import { addRewrite, rewriteChoices } from '../src/document/edits/rewrite-add';
import { setRewriteArgument } from '../src/document/edits/rewrite-argument';
import { moveRewrite } from '../src/document/edits/rewrite-move';
import { removeRewrite } from '../src/document/edits/rewrite-remove';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { queryEventsNode } from '../src/strudel/evaluate-node';
const load = (s: string) => importStrudel(s).doc;
const good = (d: ReturnType<typeof addRewrite>): Doc => {
  if ('ok' in d) throw Error(d.reason);
  return d;
};
const layers = (d: Doc) => instruments(d)[0].pattern.layers;
const rewrites = (d: Doc) => layers(d).filter((l): l is RewriteLayer => l.kind === 'rewrite');
it('adds registered rewrites with fresh ids and neutral defaults, preserving unrelated branches', () => {
  const d = load('const a=s("bd"); const b=s("hh"); stack(a,b)');
  const row = instruments(d)[0];
  expect(describeTarget(d, `${row.pattern.id}:rewrites`)).toMatchObject({
    kind: 'rewrite',
    breadcrumb: ['a', 'Rewrites'],
  });
  for (const choice of rewriteChoices) {
    const n = good(addRewrite(d, row.pattern.id, choice.name));
    expect(checkDoc(n)).toEqual([]);
    expect(n.body[1]).toBe(d.body[1]);
    expect(layers(d)).toHaveLength(0);
    expect(rewrites(n).at(-1)?.name).toBe(choice.name);
  }
  expect(addRewrite(d, 'missing', 'fast')).toMatchObject({ ok: false });
  expect(addRewrite(d, row.id, 'off')).toMatchObject({ ok: false });
});
it('edits numeric and parsed pattern arguments; refuses missing, invalid and read-only arguments', () => {
  const d = load('s("bd").fast(1).slow("<1 2>").off(.5,p=>p.rev())');
  const [fast, slow, off] = rewrites(d);
  const n = good(setRewriteArgument(d, fast.id, 0, 2));
  expect(rewrites(n)[1]).toBe(slow);
  expect(fast.args[0]).toEqual({ kind: 'literal', value: 1 });
  expect(setRewriteArgument(d, fast.id, 0, 1)).toBe(d);
  expect(good(setRewriteArgument(d, slow.id, 0, '<2 4>'))).not.toBe(d);
  for (const [id, index, value] of [
    [fast.id, 0, Infinity],
    [fast.id, 0, 0],
    [fast.id, 0, 'x'],
    [slow.id, 0, '['],
    [off.id, 1, 2],
    [fast.id, 3, 2],
    ['missing', 0, 2],
  ] as const)
    expect(setRewriteArgument(d, id, index, value)).toMatchObject({ ok: false });
});
it('moves rewrites only, respects settings/source barriers and removes exactly one layer', () => {
  const d = load('s("bd").gain(.5).fast(2).rev().gain(.8).slow(2).unknownThing().ply(2)');
  const opaque = layers(d).findIndex((l) => l.kind === 'rewrite' && l.name === 'unknownThing');
  layers(d)[opaque] = { id: 'opaque-layer', tier: 3, kind: 'opaque', code: '.unknownThing()' };
  const [fast, rev, slow, ply] = rewrites(d);
  const n = good(moveRewrite(d, rev.id, -1));
  expect(rewrites(n).map((l) => l.name)).toEqual(['rev', 'fast', 'slow', 'ply']);
  expect(layers(n)[0]).toBe(layers(d)[0]);
  expect(good(removeRewrite(d, fast.id))).not.toBe(d);
  expect(layers(d)).toContain(fast);
  for (const [id, direction] of [
    [fast.id, -1],
    [rev.id, 1],
    [slow.id, 1],
    [ply.id, -1],
    ['missing', 1],
  ] as const)
    expect(moveRewrite(d, id, direction)).toMatchObject({ ok: false });
  expect(removeRewrite(d, 'missing')).toMatchObject({ ok: false });
  expect(removeRewrite(d, instruments(d)[0].pattern.id)).toMatchObject({ ok: false });
});
it('real house: fast doubles kick onsets, degradation removes them, removal restores every instrument', async () => {
  const original = load(readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'));
  const kick = instruments(original).find((r) => r.name === 'kick')!;
  const withFast = good(addRewrite(original, kick.pattern.id, 'fast'));
  const fast = instruments(withFast)
    .find((r) => r.id === kick.id)!
    .pattern.layers.at(-1)!;
  const doubled = good(setRewriteArgument(withFast, fast.id, 0, 2));
  const reset = good(setRewriteArgument(doubled, fast.id, 0, 1));
  const added = good(addRewrite(reset, kick.pattern.id, 'degradeBy'));
  const degrade = instruments(added)
    .find((r) => r.id === kick.id)!
    .pattern.layers.at(-1)!;
  const silent = good(setRewriteArgument(added, degrade.id, 0, 1));
  const earlier = good(moveRewrite(silent, degrade.id, -1));
  expect(generate(earlier).indexOf('.degradeBy(1)')).toBeLessThan(
    generate(earlier).indexOf('.fast(1)'),
  );
  const later = good(moveRewrite(earlier, degrade.id, 1));
  expect(generate(later).indexOf('.fast(1)')).toBeLessThan(
    generate(later).indexOf('.degradeBy(1)'),
  );
  const restored = good(removeRewrite(good(removeRewrite(later, fast.id)), degrade.id));
  for (const row of instruments(original)) {
    const results = await Promise.all(
      [original, doubled, reset, silent, earlier, later, restored].map((d) =>
        queryEventsNode(generate(d, { only: row.id }), 8, 9),
      ),
    );
    results.forEach((r) => expect(r.error).toBeNull());
    const [a, b, c, d, e, f, g] = results.map((r) => r.events.filter((e) => e.hasOnset));
    if (row.id === kick.id) {
      expect(a.length).toBeGreaterThan(0);
      expect(b).toHaveLength(a.length * 2);
      expect(c).toEqual(a);
      expect(d).toEqual([]);
      expect(e).toEqual([]);
      expect(f).toEqual([]);
    } else for (const result of [b, c, d, e, f]) expect(result).toEqual(a);
    expect(g).toEqual(a);
  }
}, 20000);
it('existing real-ambient numeric rewrite edits survive generation and change only their instrument', async () => {
  const d = load(readFileSync('corpus/programs/real-ambient.strudel', 'utf8'));
  const row = instruments(d).find((r) =>
    r.pattern.layers.some(
      (l) =>
        l.kind === 'rewrite' &&
        l.args.some((a) => a.kind === 'literal' && typeof a.value === 'number'),
    ),
  )!;
  const layer = row.pattern.layers.find(
    (l): l is RewriteLayer =>
      l.kind === 'rewrite' && l.args[0]?.kind === 'literal' && typeof l.args[0].value === 'number',
  )!;
  expect(row).toBeDefined();
  const n = good(setRewriteArgument(d, layer.id, 0, 2));
  for (const r of instruments(d)) {
    const [a, b] = await Promise.all(
      [d, n].map((x) => queryEventsNode(generate(x, { only: r.id }), 0, 4)),
    );
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    if (r.id === row.id) expect(b.events).not.toEqual(a.events);
    else expect(b.events).toEqual(a.events);
  }
});
it('offers every requested pinned method and queries its generated default', async () => {
  expect(rewriteChoices.map((c) => c.name)).toEqual([
    'fast',
    'slow',
    'rev',
    'palindrome',
    'ply',
    'degradeBy',
    'early',
    'late',
    'euclid',
    'segment',
  ]);
  const d = load('s("bd ~ bd ~").gain(.4)');
  const row = instruments(d)[0];
  for (const choice of rewriteChoices) {
    const n = good(addRewrite(d, row.pattern.id, choice.name));
    const result = await queryEventsNode(generate(n), 0, 2);
    expect(result.error, choice.name).toBeNull();
  }
});
it('moving noncommuting rewrites changes event spans, sharing all settings and other instruments', async () => {
  const d = load('const a=s("bd ~").gain(.5).early(.25).slow(2); const b=s("hh*3"); stack(a,b)');
  const [early, slow] = rewrites(d),
    n = good(moveRewrite(d, slow.id, -1));
  expect(layers(n)[0]).toBe(layers(d)[0]);
  expect(rewrites(n)).toEqual([slow, early]);
  expect(good(moveRewrite(n, slow.id, 1))).toEqual(d);
  for (const row of instruments(d)) {
    const [a, b] = await Promise.all(
      [d, n].map((x) => queryEventsNode(generate(x, { only: row.id }), 0, 4)),
    );
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    if (row.name === 'a') expect(b.events).not.toEqual(a.events);
    else expect(b.events).toEqual(a.events);
  }
});

it('preserves argument metadata and refuses layered, opaque and nonnumeric source values', () => {
  const d = load('s("bd").slow(2)');
  const layer = rewrites(d)[0];
  layer.args = [
    {
      kind: 'pattern',
      name: 'factor',
      pattern: { id: 'factor', tier: 1, core: { kind: 'constant', value: 2 }, layers: [] },
    },
    { kind: 'literal', value: '<1 2>' },
    { kind: 'opaque', code: 'customRate' },
    { kind: 'literal', value: true },
  ];
  const n = good(setRewriteArgument(d, layer.id, 0, 3));
  expect(rewrites(n)[0].args[0]).toMatchObject({
    name: 'factor',
    pattern: { id: 'factor', core: { value: 3 } },
  });
  expect(rewrites(n)[0].args[1]).toBe(layer.args[1]);
  expect(good(setRewriteArgument(d, layer.id, 1, '<2 4>'))).not.toBe(d);
  for (const index of [2, 3])
    expect(setRewriteArgument(d, layer.id, index, 2)).toMatchObject({ ok: false });
  const arg = layer.args[0];
  if (arg.kind === 'pattern')
    arg.pattern.layers.push({ id: 'nested', tier: 1, kind: 'rewrite', name: 'rev', args: [] });
  expect(setRewriteArgument(d, layer.id, 0, 3)).toMatchObject({ ok: false });
});
