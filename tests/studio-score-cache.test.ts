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

test('ahead cannot replace the current answer; promotion reuses completed and in-flight requests', async () => {
  const replies: ((result: EventResult) => void)[] = [];
  const query = vi.fn(() => new Promise<EventResult>((resolve) => replies.push(resolve)));
  const cancelCurrent = vi.fn(),
    cancelAhead = vi.fn();
  const cache = createScoreCache(query, {
    cancel: cancelCurrent,
    ahead: { query, cancel: cancelAhead },
  });
  const state = piece('s("bd")');
  const first = { from: 0, to: 4 },
    second = { from: 4, to: 8 },
    third = { from: 8, to: 16 };
  cache.request(state, first, second);
  const currentCancellations = cancelCurrent.mock.calls.length;
  // Replacing an ahead request must leave the visible request alive.
  cache.request(state, first, third);
  expect(cancelCurrent).toHaveBeenCalledTimes(currentCancellations);
  replies[0](result);
  await setImmediate();
  expect(cache.score.from).toBe(0);
  expect(Object.keys(cache.score.events)).toHaveLength(1);
  replies[2](result);
  await setImmediate();
  expect(cache.score.from).toBe(0);
  cache.request(state, third, second);
  expect(cache.score.from).toBe(8);
  expect(query).toHaveBeenCalledTimes(4);
  // Promote a pending answer without canceling or repeating its worker batch.
  const aheadCancellations = cancelCurrent.mock.calls.length;
  cache.request(state, second);
  expect(cancelCurrent).toHaveBeenCalledTimes(aheadCancellations);
  expect(query).toHaveBeenCalledTimes(4);
  replies[3](result);
  await setImmediate();
  expect(cache.score.from).toBe(4);
  // An obsolete ahead answer cannot replace the promoted current request.
  replies[1]({ ...result, error: { phase: 'evaluation', message: 'obsolete' } });
  await setImmediate();
  expect(cache.score.from).toBe(4);
  expect(cache.error).toBe('');
  cache.dispose();
});

test('document replacement and disposal invalidate both request purposes', async () => {
  const replies: ((result: EventResult) => void)[] = [];
  const cache = createScoreCache(() => new Promise((resolve) => replies.push(resolve)));
  const range = { from: 0, to: 4 },
    next = { from: 4, to: 8 };
  cache.request(piece('s("bd")'), range, next);
  cache.request(piece('s("sd")'), range, next);
  replies[0](result);
  replies[1](result);
  await setImmediate();
  expect(cache.score.events).toEqual({});
  cache.dispose();
  replies[2](result);
  replies[3](result);
  await setImmediate();
  expect(cache.score.events).toEqual({});
});
