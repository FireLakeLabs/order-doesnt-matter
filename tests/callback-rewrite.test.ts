import { expect, it } from 'vitest';
import { checkDoc, findById, instruments, type Doc } from '../src/document';
import { describeTarget } from '../src/document/edit';
import { callbackBranches, callbackTrail } from '../src/document/edits/rewrite-shared';
import { addRewrite } from '../src/document/edits/rewrite-add';
import { setRewriteArgument } from '../src/document/edits/rewrite-argument';
import { moveRewrite } from '../src/document/edits/rewrite-move';
import { removeRewrite } from '../src/document/edits/rewrite-remove';
import { prepareSource } from '../src/document/edits/source-node';
import { sourceFragment } from '../src/document/edits/source-shared';
import { createEditSession } from '../src/editor/session';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { queryEventsNode as query } from './node-query';
import { callbackPiece } from './fixtures/callback-rewrite';
const load = (s: string) => importStrudel(s).doc;
function good(result: Doc | { ok: false; reason: string }): Doc {
  if ('ok' in result) throw Error(result.reason);
  return result;
}
async function notes(source: string, from: number, to: number) {
  const result = await query(source, from, to);
  expect(result.error).toBeNull();
  return result.events.filter((e) => e.hasOnset).map((e) => [e.whole, e.value]);
}

it('Kiln-derived shared callback edits preserve siblings, settings, references and every other instrument; one real Undo', async () => {
  const doc = load(callbackPiece),
    branch = callbackBranches(doc)[0];
  const [rev, fast] = branch.body.layers;
  const bass = instruments(doc).find((r) => r.name === 'bass')!;
  expect(bass.uses).toHaveLength(2);
  expect(describeTarget(doc, `${branch.body.id}:rewrites`)).toMatchObject({
    kind: 'rewrite',
    instrumentId: bass.id,
    breadcrumb: ['bass', 'every', 'Periodic change · p', 'Rewrites'],
  });
  const edited = good(setRewriteArgument(doc, fast.id, 0, 3));
  const moved = good(moveRewrite(edited, fast.id, -1));
  expect(checkDoc(moved)).toEqual([]);
  expect(callbackBranches(moved)[0].body.layers.map((l) => l.id)).toEqual([fast.id, rev.id]);
  for (const sibling of callbackBranches(doc).slice(1))
    expect(findById(moved, sibling.body.id)).toBe(sibling.body);
  expect(generate(moved)).toContain('p => p.fast(3).rev()');
  const session = createEditSession(doc, {
    playing: () => false,
    play: async () => 1,
    changed() {},
    refresh() {},
  });
  session.apply(edited, {}, fast.id);
  session.undo();
  expect(session.state.doc).toBe(doc);
  session.dispose();
  // Every's affected cycles are 0,3,...; windows also cover negative, fractional and later turns.
  for (const [from, to, affected] of [
    [0, 1, true],
    [1, 2, false],
    [3, 4, true],
    [-2.5, -1.25, true],
    [6.25, 6.75, true],
    [10, 11, false],
  ] as const) {
    for (const row of instruments(doc)) {
      const [before, after] = await Promise.all(
        [doc, moved].map((d) => notes(generate(d, { only: row.id }), from, to)),
      );
      if (row.id === bass.id && affected) expect(after).not.toEqual(before);
      else expect(after).toEqual(before);
    }
  }
  // Reverse and fast can coincide in a window; order is proved structurally, never inferred to commute.
  expect(callbackBranches(doc)[0].body.layers).toEqual([rev, fast]);
});

it.each([
  ['every(3,p=>p.pan(.8))', 'Periodic change'],
  ['off(.25,p=>p.pan(.8))', 'Shifted copy'],
  ['jux(p=>p.gain(.7))', 'Right channel'],
  ['sometimes(p=>p.pan(.8))', 'Time-addressed change'],
  ['when("<0 1>",p=>p.pan(.8))', 'Conditional change'],
  ['superimpose(p=>p.pan(.8))', 'Added copy'],
  ['layer(a=>a.pan(.2),b=>b.pan(.8))', 'Branch 1'],
])('pinned engine branch/arity canary: %s', async (call, role) => {
  const source = `note("fs2 a2 cs3").s("triangle").${call}`;
  const doc = load(source),
    branches = callbackBranches(doc);
  expect(branches[0]).toMatchObject({ supported: true, role });
  for (const [from, to] of [
    [-0.5, 2.25],
    [13.25, 16.5],
  ]) {
    const expected = await notes(source, from, to);
    expect(expected.length).toBeGreaterThan(0);
    expect(await notes(generate(doc), from, to)).toEqual(expected);
    expect(await notes(generate(doc), from, to)).toEqual(expected); // Same absolute random/time windows.
  }
});

it('off is a shifted copy, jux keeps its channel values, and layer siblings are independent ordered branches', async () => {
  const off = await notes('note("fs2 a2").off(.25,p=>p.pan(.8))', 0, 1);
  expect(off.map(([span]) => span)).toEqual([
    [0, 0.5],
    [0.5, 1],
    [0.25, 0.75],
    [0.75, 1.25],
  ]);
  expect(off.map(([, value]) => value)).toEqual([
    { note: 'fs2' },
    { note: 'a2' },
    { note: 'fs2', pan: 0.8 },
    { note: 'a2', pan: 0.8 },
  ]);
  const jux = await notes('note("fs2 a2").jux(p=>p.gain(.7))', 0, 1);
  expect(jux.map(([, v]) => v)).toEqual([
    { note: 'fs2', pan: 0 },
    { note: 'a2', pan: 0 },
    { note: 'fs2', gain: 0.7, pan: 1 },
    { note: 'a2', gain: 0.7, pan: 1 },
  ]);
  const doc = load(
    'const rate=2; note("fs2 a2").layer(a=>a.early(.25).slow(rate),b=>b.rev().pan(.8))',
  );
  const [a, b] = callbackBranches(doc),
    inner = a.body.layers[0];
  const moved = good(moveRewrite(doc, inner.id, 1));
  expect(findById(moved, b.body.id)).toBe(b.body);
  expect(generate(moved)).toContain('a => a.slow(rate).early(0.25)');
  expect(generate(moved)).toContain('b => b.rev().pan(0.8)');
  expect(await notes(generate(moved), -1.5, 4.25)).not.toEqual(
    await notes(generate(doc), -1.5, 4.25),
  );
});

it('nested names, pattern arguments, append/remove and opaque barriers preserve the exact lexical scope', async () => {
  const doc = load(
    'const rate=2; note("fs2 a2").every(3,outer$=>outer$.off(.25,copy=>copy.fast("<1 2>").slow(rate)).gain(.4))',
  );
  const [outer, inner] = callbackBranches(doc),
    fast = inner.body.layers[0];
  expect(callbackTrail(doc, fast.id).map((b) => b.parameter)).toEqual(['outer$', 'copy']);
  expect(describeTarget(doc, fast.id).breadcrumb).toContain('Periodic change · outer$');
  const edited = good(setRewriteArgument(doc, fast.id, 0, '<2 3>'));
  expect(sourceFragment(edited, fast.id)).toBe('.fast("<2 3>")');
  expect(generate(edited)).toContain('copy => copy.fast("<2 3>").slow(rate)');
  const added = good(addRewrite(edited, inner.body.id, 'rev'));
  const tail = callbackBranches(added)[1].body.layers.at(-1)!;
  expect(good(removeRewrite(added, tail.id))).toEqual(edited);
  expect(findById(added, outer.body.layers.at(-1)!.id)).toBe(outer.body.layers.at(-1));
  // A literal setting is retained, and opaque layers are never crossed.
  const barrier = structuredClone(doc);
  callbackBranches(barrier)[1].body.layers.splice(1, 0, {
    id: 'barrier',
    tier: 3,
    kind: 'opaque',
    code: '.unknownThing()',
  });
  expect(moveRewrite(barrier, fast.id, 1)).toMatchObject({ ok: false });
  expect(setRewriteArgument(doc, outer.parent.id, 1, 3)).toMatchObject({ ok: false });
  const wrong = load('note(60).every(3,p=>p.rev(),4)');
  expect(callbackBranches(wrong)[0].supported).toBe(false);
  expect(addRewrite(wrong, callbackBranches(wrong)[0].body.id, 'fast')).toMatchObject({
    ok: false,
  });
  const [before, after] = await Promise.all(
    [doc, edited].map((d) => notes(generate(d), -0.25, 7.5)),
  );
  expect(after).not.toEqual(before);
});

it('source is independent per argument, malformed text refuses, unknown functions fail a real query, and supported text revalidates', async () => {
  const doc = load('note("fs2 a2").every(3,p=>{return p.rev()}).when(customPredicate,p=>p.rev())');
  const row = instruments(doc)[0],
    [every, when] = row.pattern.layers.filter((l) => l.kind === 'rewrite');
  expect(callbackBranches(doc).map((b) => b.parent.name)).toEqual(['when']);
  const id = `${every.id}:arg:1`;
  expect(sourceFragment(doc, id)).toContain('return p.rev()');
  const ask = (d: Doc) => query(generate(d), -1, 7);
  expect(await prepareSource(doc, id, 'p => (', ask)).toMatchObject({ ok: false });
  // Use a valid independent piece so the unknown callback is the failing boundary.
  const valid = load('note("fs2 a2").every(3,p=>p.rev())');
  const address = `${callbackBranches(valid)[0].parent.id}:arg:1`;
  const unknown = await prepareSource(valid, address, 'voice=>voice.notARealRewrite()', ask);
  expect(unknown).toMatchObject({
    promoted: false,
    broken: expect.stringContaining('notARealRewrite'),
  });
  const repaired = await prepareSource(doc, id, 'voice=>voice.rev().fast(2)', async (d) =>
    query(generate(d).replaceAll('customPredicate', '1'), -1, 7),
  );
  expect(repaired).toMatchObject({ promoted: true, broken: '' });
  if ('ok' in repaired) throw Error(repaired.reason);
  expect(findById(repaired.doc, when.id)).toBe(when);
  expect(sourceFragment(repaired.doc, `${when.id}:arg:0`)).toBe('customPredicate');
  expect(callbackBranches(repaired.doc)[0].parameter).toBe('voice');
});

it('editing a use-site callback keeps the canonical definition and other sections unchanged', async () => {
  const doc = load(
    'const bass=note("fs2 a2").s("triangle"); const drum=s("bd"); arrange([1,stack(bass.every(2,p=>p.fast(2)),drum)],[1,stack(bass,drum)])',
  );
  const branch = callbackBranches(doc)[0];
  const fast = branch.body.layers[0];
  const bass = instruments(doc).find((r) => r.name === 'bass')!;
  expect(describeTarget(doc, fast.id).section?.start).toBe(0);
  const changed = good(setRewriteArgument(doc, fast.id, 0, 3));
  expect(instruments(changed).find((r) => r.id === bass.id)!.pattern).toBe(bass.pattern);
  for (const [from, to, affected] of [
    [0, 1, true],
    [1, 2, false],
    [3, 4, false],
  ] as const) {
    const before = await notes(generate(doc), from, to);
    const after = await notes(generate(changed), from, to);
    if (affected) expect(after).not.toEqual(before);
    else expect(after).toEqual(before);
  }
});
