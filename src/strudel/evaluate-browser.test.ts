import { expect, it, vi, afterEach } from 'vitest';
import { createBrowserQueries, QUERY_BUDGET_MS, type QuestionWorker } from './evaluate-browser';
import type { EventResult } from '../contract';
afterEach(() => vi.useRealTimers());
const ok: EventResult = { events: [], error: null, cps: 1, opaqueValues: false };
function fake() {
  const worker: QuestionWorker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
  return worker;
}
it('terminates an overrun and returns timeout within the wall budget', async () => {
  vi.useFakeTimers();
  const w = fake(),
    q = createBrowserQueries(() => w);
  const pending = q.query('loop', 0, 4);
  await vi.advanceTimersByTimeAsync(QUERY_BUDGET_MS);
  expect(await pending).toMatchObject({ error: { phase: 'timeout' } });
  expect(w.terminate).toHaveBeenCalledOnce();
});
it('cancels active and queued questions and ignores late worker results', async () => {
  const workers: QuestionWorker[] = [];
  const q = createBrowserQueries(
    () => {
      const w = fake();
      workers.push(w);
      return w;
    },
    { size: 1 },
  );
  const a = q.query('a', 0, 1),
    b = q.query('b', 0, 1);
  const old = workers[0].onmessage!;
  q.cancel();
  old({ data: ok });
  expect((await a).error?.message).toContain('cancelled');
  expect((await b).error?.message).toContain('cancelled');
  const c = q.query('c', 0, 1);
  workers[1].onmessage!({ data: ok });
  expect(await c).toEqual(ok);
  expect(workers[0].terminate).toHaveBeenCalledOnce();
});
it('bounds concurrency, releases capacity on success, crash and construction failure', async () => {
  const workers: QuestionWorker[] = [];
  const q = createBrowserQueries(
    () => {
      const w = fake();
      workers.push(w);
      return w;
    },
    { size: 2 },
  );
  const pending = [q.query('a', 0, 1), q.query('b', 0, 1), q.query('c', 0, 1)];
  expect(workers).toHaveLength(2);
  workers[0].onmessage!({ data: ok });
  expect(workers).toHaveLength(3);
  workers[1].onerror!({ message: 'crash' });
  workers[2].onmessage!({ data: ok });
  expect((await Promise.all(pending))[1]).toMatchObject({
    error: { phase: 'evaluation', message: 'crash' },
  });
  const broken = createBrowserQueries(() => {
    throw Error('unavailable');
  });
  expect(await broken.query('', 0, 1)).toMatchObject({ error: { message: 'unavailable' } });
});
