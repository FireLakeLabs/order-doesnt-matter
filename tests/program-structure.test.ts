import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { expect, test, vi } from 'vitest';
import { findById, instruments, type Layer, type Setting, type Pattern } from '../src/document';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import type { EventResult, QueryEvents } from '../src/contract';
import type { ViewSnapshot } from '../src/views/types';
import { createStructureCache } from '../src/studio/program-structure';
import { queryEventsNode as query } from './node-query';

const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
const doc = importStrudel(source).doc;
const bass = instruments(doc).find((row) => row.name === 'wobbleBass')!;
const range = { from: 8, to: 12 };
const empty: EventResult = { events: [], cps: 0.5, error: null, opaqueValues: false };
const cacheFor = (query: QueryEvents) => createStructureCache({ query, cancel() {} });
function answer(snapshot: ViewSnapshot) {
  expect(snapshot.status).toBe('available');
  if (snapshot.status !== 'available') throw Error(snapshot.reason);
  expect(snapshot.result.error).toBeNull();
  return snapshot.result;
}

test('dubstep chain uses document ids/order/arguments; every prefix is queried, with five raw notes and an exact final score', async () => {
  const measured: { step: number; ms: number }[] = [];
  const questions = vi.fn(query);
  const cache = cacheFor(questions);
  const structure = cache.forFrame(doc, range).get(bass.id)!;
  const chain = bass.pattern.layers.flatMap<Layer | Setting>((layer) =>
    layer.kind === 'settings' ? layer.settings : [layer],
  );
  expect(structure.steps.map((step) => step.id)).toEqual([
    bass.pattern.id,
    ...chain.map((node) => node.id),
  ]);
  expect(structure.steps[0]).toMatchObject({
    kind: 'phrase',
    core: bass.pattern.core,
    opaque: null,
  });
  chain.forEach((node, index) => {
    if ('name' in node) expect(structure.steps[index + 1]).toMatchObject({ name: node.name });
    if ('args' in node) expect(structure.steps[index + 1]).toMatchObject({ args: node.args });
    if ('value' in node)
      expect(structure.steps[index + 1]).toMatchObject({
        args: [{ kind: 'pattern', pattern: node.value }],
      });
  });
  expect(questions).not.toHaveBeenCalled();
  const snapshots: EventResult[] = [];
  for (let index = 0; index < structure.steps.length; index++) {
    const start = performance.now();
    const pending = structure.snapshot(index);
    expect(structure.snapshot(index)).toBe(pending);
    snapshots.push(answer(await pending));
    measured.push({ step: index, ms: performance.now() - start });
    // Independently construct this prefix from the original document.
    const copy = structuredClone(doc);
    const pattern = findById(copy, bass.pattern.id) as Pattern;
    let remaining = index;
    pattern.layers = pattern.layers.flatMap<Layer>((layer) => {
      if (layer.kind === 'settings') {
        const settings = layer.settings.slice(0, remaining);
        remaining -= settings.length;
        return settings.length ? [{ ...layer, settings }] : [];
      }
      return remaining-- > 0 ? [layer] : [];
    });
    expect(snapshots[index]).toEqual(
      await query(generate(copy, { only: bass.id }), range.from, range.to),
    );
  }
  const raw = snapshots[0].events.filter((event) => event.hasOnset);
  expect(raw.map((event) => event.value)).toEqual([
    { note: 'c2' },
    { note: 'c2' },
    { note: 'eb2' },
    { note: 'f2' },
    { note: 'g2' },
  ]);
  expect(raw.map((event) => event.whole)).toEqual([
    [8, 9],
    [9, 10],
    [10, 11],
    [11, 11.5],
    [11.5, 12],
  ]);
  expect(snapshots.at(-1)).toEqual(
    await query(generate(doc, { only: bass.id }), range.from, range.to),
  );
  const calls = questions.mock.calls.length;
  const start = performance.now();
  for (let index = 0; index < structure.steps.length; index++)
    expect(answer(await cache.forFrame(doc, range).get(bass.id)!.snapshot(index))).toBe(
      snapshots[index],
    );
  const hitMs = performance.now() - start;
  expect(questions).toHaveBeenCalledTimes(calls);
  console.log(
    'STRUCTURE NODE MEASURED (retained test-worker pool)',
    JSON.stringify({ measured, hitMs, queries: calls, cacheHits: structure.steps.length }),
  );
  cache.dispose();
});

test('filter signal exposes its own branch and the <2 4 3 8> rate events', async () => {
  const cache = cacheFor(query);
  const structure = cache.forFrame(doc, range).get(bass.id)!;
  const filter = structure.steps.find((step) => step.kind === 'setting' && step.name === 'cutoff')!;
  if (filter.kind !== 'setting') throw Error('No filter');
  expect(filter.driver).toMatchObject({
    kind: 'signal',
    pattern: { core: { kind: 'signal', shape: 'sine' } },
    opaque: null,
  });
  expect(filter.driver.rates).toHaveLength(1);
  expect(filter.driver.rates[0]).toMatchObject({
    name: 'fast',
    args: [{ kind: 'pattern', pattern: { core: { kind: 'sequence', notation: '<2 4 3 8>' } } }],
  });
  const rates = answer(await filter.driver.rates[0].events());
  expect(rates.events.map((event) => event.value)).toEqual([2, 4, 3, 8]);
  expect(rates.events.map((event) => event.whole)).toEqual([
    [8, 9],
    [9, 10],
    [10, 11],
    [11, 12],
  ]);
  expect(answer(await filter.driver.events()).events.every((event) => event.whole === null)).toBe(
    true,
  );
  cache.dispose();
});

test('rewrites change real Strudel events, shared drivers retain rate structure, and failed queries stay broken', async () => {
  const doc = importStrudel(
    'const driver = sine.fast("<2 4>"); note("c e").rev().fast(2).lpf(driver.range(100, 900))',
  ).doc;
  const row = instruments(doc)[0];
  const cache = cacheFor(query);
  const structure = cache.forFrame(doc, { from: 0, to: 2 }).get(row.id)!;
  const raw = answer(await structure.snapshot(0));
  const reversed = answer(await structure.snapshot(1));
  expect(raw.events).not.toEqual(reversed.events);
  expect(reversed.events.find((event) => event.whole?.[0] === 0)!.value).toEqual({ note: 'e' });
  expect(answer(await structure.snapshot(2)).events).toHaveLength(8);
  const filter = structure.steps.at(-1)!;
  if (filter.kind !== 'setting') throw Error('No filter');
  expect(filter.driver.kind).toBe('signal');
  expect(answer(await filter.driver.rates[0].events()).events.map((event) => event.value)).toEqual([
    2, 4,
  ]);
  cache.dispose();
  const broken = cacheFor(async () => ({
    ...empty,
    error: { phase: 'query', message: 'Broken question' },
  }));
  expect(await broken.forFrame(doc, range).get(row.id)!.snapshot(0)).toMatchObject({
    status: 'available',
    result: { error: { message: 'Broken question' } },
  });
  broken.dispose();
});

test('source-first corpus callback step is opaque with its reason, including later prefixes', async () => {
  const doc = importStrudel(
    readFileSync('corpus/programs/micro-callback-deep.strudel', 'utf8'),
  ).doc;
  const row = instruments(doc)[0];
  const questions = vi.fn(query);
  const cache = cacheFor(questions);
  const structure = cache.forFrame(doc, range).get(row.id)!;
  const index = structure.steps.findIndex(
    (step) => step.kind === 'rewrite' && step.name === 'layer',
  );
  expect(index).toBeGreaterThan(0);
  expect(structure.steps[index].opaque).toContain('Callback');
  expect(await structure.snapshot(index)).toMatchObject({
    status: 'unavailable',
    reason: expect.stringContaining('Callback'),
  });
  expect(questions).not.toHaveBeenCalled();
  expect(answer(await structure.snapshot(0)).events).toHaveLength(16);
  cache.dispose();
});

test('cache deduplicates queued work, bounds requests/results and expires old frames on replacement/disposal', async () => {
  const replies: ((value: EventResult) => void)[] = [];
  const questions = vi.fn(() => new Promise<EventResult>((resolve) => replies.push(resolve)));
  const cancel = vi.fn();
  const cache = createStructureCache({ query: questions, cancel });
  const frame = cache.forFrame(doc, range);
  const structure = frame.get(bass.id)!;
  const pending = structure.snapshot(0);
  expect(structure.snapshot(0)).toBe(pending);
  expect(questions).not.toHaveBeenCalled();
  await setImmediate();
  expect(questions).toHaveBeenCalledTimes(1);
  const queued = Array.from({ length: 31 }, (_, index) =>
    cache
      .forFrame(doc, { from: index + 20, to: index + 21 })
      .get(bass.id)!
      .snapshot(0),
  );
  expect(await cache.forFrame(doc, { from: 99, to: 100 }).get(bass.id)!.snapshot(0)).toMatchObject({
    status: 'unavailable',
    reason: expect.stringContaining('full'),
  });
  cache.forFrame(structuredClone(doc), range);
  expect(await pending).toMatchObject({
    status: 'unavailable',
    reason: expect.stringContaining('expired'),
  });
  expect((await Promise.all(queued)).every((result) => result.status === 'unavailable')).toBe(true);
  expect(frame.get(bass.id)).toBeUndefined();
  replies[0](empty);
  await setImmediate();
  expect(questions).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(2);
  cache.dispose();

  const immediate = vi.fn(async () => empty);
  const bounded = cacheFor(immediate);
  for (let i = 0; i < 66; i++)
    await bounded
      .forFrame(doc, { from: i, to: i + 1 })
      .get(bass.id)!
      .snapshot(0);
  await bounded.forFrame(doc, { from: 65, to: 66 }).get(bass.id)!.snapshot(0);
  expect(immediate).toHaveBeenCalledTimes(66);
  await bounded.forFrame(doc, { from: 0, to: 1 }).get(bass.id)!.snapshot(0);
  expect(immediate).toHaveBeenCalledTimes(67);
  const old = bounded.forFrame(doc, range).get(bass.id)!;
  bounded.dispose();
  bounded.forFrame(doc, range);
  expect(await old.snapshot(0)).toMatchObject({ status: 'unavailable' });
  bounded.dispose();
});
