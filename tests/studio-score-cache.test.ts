import { expect, test, vi } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { initialState, loadPiece } from '../src/app/state';
import { importStrudel } from '../src/import';
import { createScoreCache } from '../src/studio/score-cache';
import type { EventResult } from '../src/contract';

const result: EventResult = { events: [], cps: 0.5, error: null, opaqueValues: false };
const piece = (source: string) => loadPiece(initialState(), '', importStrudel(source));

test('successive view consumers reuse a completed stage score; document and range changes invalidate', async () => {
  const query = vi.fn(async () => result);
  const stage = createScoreCache(query);
  const document = piece('stack(s("bd"), s("sd"))');
  const range = { from: 0, to: 16 };
  stage.request(document, range);
  await vi.waitFor(() => expect(Object.keys(stage.score.events)).toHaveLength(2));
  const ready = stage.score;
  // The new drawing requests the same document/range from the retained owner.
  stage.request(document, range);
  expect(query).toHaveBeenCalledTimes(2);
  expect(stage.score).toBe(ready);

  const changed = piece('stack(s("hh"), s("cp"))');
  stage.request(changed, range);
  expect(stage.notes).toEqual([]);
  expect(stage.score.events).toEqual({});
  await vi.waitFor(() => expect(Object.keys(stage.score.events)).toHaveLength(2));
  expect(query).toHaveBeenCalledTimes(4);
  stage.request(changed, { from: 16, to: 32 });
  await vi.waitFor(() => expect(stage.score.from).toBe(16));
  expect(query).toHaveBeenCalledTimes(6);
  stage.dispose();
});

test('releasing the stage rejects pending replies, including an older document', async () => {
  const replies: ((result: EventResult) => void)[] = [];
  const cache = createScoreCache(() => new Promise((resolve) => replies.push(resolve)));
  cache.request(piece('s("bd")'), { from: 0, to: 16 });
  cache.request(piece('s("sd")'), { from: 0, to: 16 });
  replies[0](result);
  await setImmediate();
  expect(cache.score.events).toEqual({});
  cache.dispose();
  replies[1](result);
  await setImmediate();
  expect(cache.score.events).toEqual({});
});

test('cleanup followed by setup can re-ask a canceled request at the same range', async () => {
  const replies: ((result: EventResult) => void)[] = [];
  const query = vi.fn(() => new Promise<EventResult>((resolve) => replies.push(resolve)));
  const cache = createScoreCache(query);
  const state = piece('s("bd")');
  const range = { from: 0, to: 16 };
  cache.request(state, range);
  cache.dispose();
  cache.request(state, range);
  expect(query).toHaveBeenCalledTimes(2);
  replies[0](result);
  await setImmediate();
  expect(cache.score.events).toEqual({});
  replies[1](result);
  await vi.waitFor(() => expect(Object.keys(cache.score.events)).toHaveLength(1));
  cache.dispose();
});
