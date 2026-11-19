import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { expect, test, vi } from 'vitest';
import { findById, instruments, walk, type Doc, type Pattern, type Setting } from '../src/document';
import { setConstant } from '../src/document/edits/set-constant';
import { replaceMiniStep } from '../src/document/edits/mini-replace';
import { setValue } from '../src/document/edits/values-set';
import { history, push, undo, redo } from '../src/editor/history';
import { createEditSession } from '../src/editor/session';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { createHistoryLookup } from '../src/studio/history-lookup';
import { instrumentInventory } from '../src/studio/instrument-names';
import type { EventResult, QueryEvents } from '../src/contract';
import type { ViewHistorySnapshot } from '../src/views/types';
import { queryEventsNode as query } from './node-query';

const doc = importStrudel(
  readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
).doc;
const range = { from: 8, to: 12 };
const empty: EventResult = { events: [], cps: 0.5, error: null, opaqueValues: false };
const cacheFor = (query: QueryEvents) => createHistoryLookup({ query, cancel() {} });
function good(result: Doc | { ok: false; reason: string }): Doc {
  if ('ok' in result) throw Error(result.reason);
  return result;
}
function score(value: ViewHistorySnapshot) {
  if (value.status !== 'available') throw Error(value.reason);
  return value.score;
}
const bass = instruments(doc).find((row) => row.name === 'wobbleBass')!;
const gain = bass.pattern.layers
  .flatMap((layer) => (layer.kind === 'settings' ? layer.settings : []))
  .find((setting) => setting.name === 'gain')!;

function edits() {
  let hat = '';
  walk(doc, (node) => {
    if (
      'core' in node &&
      (node as Pattern).core.kind === 'sequence' &&
      'notation' in (node as Pattern).core &&
      ((node as Pattern).core as { notation: string }).notation === 'hh*8'
    )
      hat = node.id;
  });
  const a = good(replaceMiniStep(doc, hat + ':rhythm', [0], 'hh*16'));
  const b = good(setConstant(a, gain.id, 0.5));
  // The generator's first argument is the note sequence.
  const pattern = bass.pattern.core;
  if (pattern.kind !== 'generator' || pattern.args[0].kind !== 'pattern') throw Error('No notes');
  const c = good(setValue(b, bass.pattern.id + ':rhythm', [0, 0], 'd2'));
  return [a, b, c];
}

test('three dubstep edits equal direct Strudel scores; ids survive undo/redo and a branch drops the future', async () => {
  const querySpy = vi.fn(query);
  const cache = cacheFor(querySpy);
  let h = history(doc);
  const docs = [doc, ...edits()];
  for (const next of docs.slice(1)) h = push(h, next, 'document');
  let lookup = cache.forFrame(h, range);
  const ids = lookup.versions.map((version) => version.id);
  expect(querySpy).not.toHaveBeenCalled();
  const answers = [];
  for (const [index, version] of lookup.versions.entries()) {
    const pending = lookup.score(version.id);
    expect(lookup.score(version.id)).toBe(pending);
    const result = score(await pending);
    const original = docs[index];
    const visual = structuredClone(original);
    walk(visual, (node) => {
      if ('muted' in node) node.muted = false;
    });
    const rows = instruments(original);
    expect(result.instruments.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    for (const [i, row] of result.instruments.entries()) {
      expect(row.result).toEqual(
        await query(generate(visual, { only: row.id }), range.from, range.to),
      );
      expect(row.result.error).toBeNull();
      expect(row.patternId).toBe(rows[i].pattern.id);
      expect(row.uses).toEqual(
        rows[i].uses.map((use) => ({
          voiceId: use.voiceId,
          pathIds: use.path.map((node) => node.id),
        })),
      );
      expect(row.path.length).toBeGreaterThan(0);
    }
    answers.push(result);
    expect(version).not.toHaveProperty('target');
    expect(version).not.toHaveProperty('kind');
  }
  for (let i = 1; i < answers.length; i++) expect(answers[i]).not.toEqual(answers[i - 1]);
  const calls = querySpy.mock.calls.length;
  h = undo(h);
  lookup = cache.forFrame(h, range);
  expect(lookup.versions.map((v) => v.id)).toEqual(ids);
  expect(lookup.versions.map((v) => v.position)).toEqual(['past', 'past', 'present', 'future']);
  h = redo(h);
  lookup = cache.forFrame(h, range);
  expect(lookup.versions.map((v) => v.id)).toEqual(ids);
  expect(score(await lookup.score(ids[0]))).toBe(answers[0]);
  expect(querySpy).toHaveBeenCalledTimes(calls);
  h = push(undo(h), good(setConstant(docs[2], gain.id, 0.6)), gain.id);
  const branch = cache.forFrame(h, range);
  expect(branch.versions.slice(0, 3).map((v) => v.id)).toEqual(ids.slice(0, 3));
  expect(branch.versions.at(-1)!.id).not.toBe(ids[3]);
  expect(await lookup.score(ids[3])).toMatchObject({ status: 'unavailable' });
  cache.dispose();
});

test('the editor history accessor is detached, deeply frozen and identity-stable through edits and undo/redo', () => {
  const changed = vi.fn();
  const editor = createEditSession(doc, {
    playing: () => false,
    play: async () => 0,
    changed,
    refresh() {},
  });
  const first = editor.history;
  expect(first).toBe(editor.history);
  expect(first.present).not.toBe(doc);
  expect(() => first.present.body.splice(0)).toThrow(TypeError);
  expect(() =>
    Object.assign(findById(first.present, gain.id) as Setting, { name: 'broken' }),
  ).toThrow(TypeError);
  expect(() => Object.assign(first, { depth: 1 })).toThrow(TypeError);
  editor.edit(gain.id, 0.5);
  const next = editor.history;
  expect(() => (next.past as Doc[]).pop()).toThrow(TypeError);
  expect(next.past[0]).toBe(first.present);
  editor.undo();
  expect(editor.history.present).toBe(first.present);
  expect(() => (editor.history.future as Doc[]).pop()).toThrow(TypeError);
  editor.redo();
  expect(editor.history.present).toBe(next.present);
  expect(editor.state.doc).toEqual(good(setConstant(doc, gain.id, 0.5)));
  expect(editor.canUndo).toBe(true);
  expect(editor.canRedo).toBe(false);
  expect(changed).toHaveBeenCalledTimes(3);
  editor.dispose();
});

test('rejected questions and Strudel errors are retriable, with the error preserved', async () => {
  const ask = vi
    .fn<QueryEvents>()
    .mockRejectedValueOnce(Error('worker failed'))
    .mockResolvedValueOnce({ ...empty, error: { phase: 'query', message: 'bad pattern' } })
    .mockResolvedValue(empty);
  const cache = cacheFor(ask);
  const frame = cache.forFrame(history(importStrudel('s("hh")').doc), range);
  const id = frame.versions[0].id;
  expect(await frame.score(id)).toEqual({ status: 'unavailable', reason: 'worker failed' });
  expect(score(await frame.score(id)).instruments[0].result.error?.message).toBe('bad pattern');
  const result = await frame.score(id);
  expect(score(result).instruments[0].result.error).toBeNull();
  expect(await frame.score(id)).toBe(result);
  expect(ask).toHaveBeenCalledTimes(3);
  cache.dispose();
});

test('32 outstanding versions/ranges bound a serial queue; a full queue has a retry path', async () => {
  const replies: ((result: EventResult) => void)[] = [];
  const ask = vi.fn(() => new Promise<EventResult>((resolve) => replies.push(resolve)));
  const cache = cacheFor(ask);
  const h = history(importStrudel('s("hh")').doc);
  const id = cache.forFrame(h, range).versions[0].id;
  const pending = Array.from({ length: 32 }, (_, i) =>
    cache.forFrame(h, { from: i, to: i + 1 }).score(id),
  );
  const retry = cache.forFrame(h, { from: 32, to: 33 });
  expect(await retry.score(id)).toMatchObject({
    status: 'unavailable',
    reason: expect.stringContaining('full'),
  });
  expect(ask).toHaveBeenCalledTimes(1);
  replies[0](empty);
  await pending[0];
  const accepted = retry.score(id);
  for (let i = 1; i <= 32; i++) {
    await setImmediate();
    expect(ask).toHaveBeenCalledTimes(i + 1);
    replies[i](empty);
  }
  await Promise.all([...pending, accepted]);
  cache.dispose();
});

test('64 completed entries bound the cache; pruning and disposal settle queued/active callers', async () => {
  const ask = vi.fn(async () => empty);
  const cancel = vi.fn();
  const cache = createHistoryLookup({ query: ask, cancel });
  let h = history(importStrudel('s("hh")').doc);
  const first = cache.forFrame(h, { from: 0, to: 1 });
  const id = first.versions[0].id;
  for (let i = 0; i < 65; i++) await cache.forFrame(h, { from: i, to: i + 1 }).score(id);
  await first.score(id);
  expect(ask).toHaveBeenCalledTimes(66);
  expect(await first.score('unknown')).toMatchObject({ status: 'unavailable' });
  expect(await cache.forFrame(h, { from: 0, to: Infinity }).score(id)).toMatchObject({
    status: 'unavailable',
  });
  h = history(importStrudel('s("bd")').doc);
  cache.forFrame(h, range);
  expect(await first.score(id)).toMatchObject({ status: 'unavailable' });
  cache.dispose();

  const stuck = createHistoryLookup({ query: () => new Promise(() => {}), cancel });
  const old = stuck.forFrame(h, range);
  const a = old.score(old.versions[0].id);
  const b = stuck.forFrame(h, { from: 4, to: 8 }).score(old.versions[0].id);
  await setImmediate();
  stuck.update(null);
  expect(await a).toMatchObject({ status: 'unavailable' });
  expect(await b).toMatchObject({ status: 'unavailable' });
  const current = stuck.forFrame(h, range);
  const c = current.score(current.versions[0].id);
  stuck.dispose();
  expect(await c).toMatchObject({ status: 'unavailable' });
  expect(await current.score(current.versions[0].id)).toMatchObject({ status: 'unavailable' });
});

test('measure all 50 retained past dubstep versions plus present, then cache hits', async () => {
  const ask = vi.fn(query);
  const cache = cacheFor(ask);
  let h = history(doc);
  for (let i = 0; i < 55; i++)
    h = push(h, good(setConstant(h.present, gain.id, 0.1 + i / 100)), gain.id);
  const editor = createEditSession(h.past[0], {
    playing: () => false,
    play: async () => 0,
    changed() {},
    refresh() {},
  });
  for (const next of [...h.past.slice(1), h.present]) editor.apply(next);
  const start = performance.now();
  const exposed = editor.history;
  const exposureMs = performance.now() - start;
  const describeStart = performance.now();
  const frame = cache.forFrame(exposed, range);
  const metadataMs = performance.now() - describeStart;
  expect(frame.versions).toHaveLength(51);
  expect(ask).not.toHaveBeenCalled();
  const costs = [];
  let events = 0;
  for (const version of frame.versions) {
    const start = performance.now();
    const answer = score(await frame.score(version.id));
    costs.push(performance.now() - start);
    for (const row of answer.instruments) {
      expect(row.result.error).toBeNull();
      events += row.result.events.length;
    }
  }
  const calls = ask.mock.calls.length;
  const hitStart = performance.now();
  for (const version of frame.versions) await frame.score(version.id);
  const hitsMs = performance.now() - hitStart;
  expect(ask).toHaveBeenCalledTimes(calls);
  const sorted = costs.toSorted((a, b) => a - b);
  console.log(
    'HISTORY NODE MEASURED (retained worker pool)',
    JSON.stringify({
      versions: 51,
      range,
      exposureMs,
      metadataMs,
      queries: calls,
      events,
      totalMs: costs.reduce((a, b) => a + b, 0),
      medianMs: sorted[25],
      p95Ms: sorted[48],
      hitsMs,
      cacheHits: 51,
    }),
  );
  cache.dispose();
  editor.dispose();
}, 60_000);

test('stored score names belong to their own document version, including generated section suffixes', async () => {
  const next = structuredClone(doc);
  walk(next, (node) => {
    if ('core' in node) {
      const pattern = node as Pattern;
      if (pattern.core.kind === 'sequence' && pattern.core.notation === 'hh*8')
        pattern.core = {
          kind: 'sequence',
          notation: 'sd*8',
          steps: [{ kind: 'value', value: 'sd', repeat: 8 }],
        };
    }
  });
  const cache = cacheFor(async () => empty);
  const lookup = cache.forFrame(push(history(doc), next, 'document'), range);
  const answers = await Promise.all(
    lookup.versions.map(async (v) => score(await lookup.score(v.id))),
  );
  const oldRows = instruments(doc),
    newRows = instruments(next);
  expect(answers[0].instruments.map((r) => r.name)).toEqual(
    instrumentInventory({ doc, rows: oldRows }).names,
  );
  expect(answers[1].instruments.map((r) => r.name)).toEqual(
    instrumentInventory({ doc: next, rows: newRows }).names,
  );
  const oldHat = answers[0].instruments.find((r) => r.name === 'hh · drop')!;
  expect(oldHat).toBeDefined();
  expect(answers[1].instruments.find((r) => r.id === oldHat.id)?.name).toBe('sd · drop 2');
  expect(answers[0].instruments.find((r) => r.id === oldHat.id)?.name).toBe('hh · drop');
  cache.dispose();
});
