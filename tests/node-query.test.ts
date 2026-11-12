import { expect, test } from 'vitest';
import { createNodeQueryPool, queryEventsNode } from '../src/strudel/evaluate-node';

test('pooled questions restore registries and tempo, execute independently, and bound events', async () => {
  const pool = createNodeQueryPool(1);
  try {
    expect(
      (
        await pool.query(
          "register('temporaryGain',(x,p)=>p.gain(x)); setcpm(120); note(60).temporaryGain(.2)",
          0,
          1,
        )
      ).error,
    ).toBeNull();
    expect((await pool.query('note(60).temporaryGain(.2)', 0, 1)).error?.phase).toBe('evaluation');
    const source =
      'globalThis.odmQueryCount=(globalThis.odmQueryCount??0)+1; note(globalThis.odmQueryCount)';
    const [a, b] = await Promise.all([pool.query(source, 0, 1), pool.query(source, 0, 1)]);
    expect(a).toMatchObject({ cps: 0.5, error: null, events: [{ value: { note: 1 } }] });
    expect(b).toMatchObject({ cps: 0.5, error: null, events: [{ value: { note: 2 } }] });
    expect((await pool.query('s("bd*8")', 0, 1, { eventBudget: 4 })).error?.phase).toBe('query');
    const fresh = await queryEventsNode(source, 0, 1);
    expect(fresh.events[0].value).toEqual({ note: 1 });
  } finally {
    await pool.close();
  }
});

test('a stuck pool slot is terminated and replaced without poisoning queued work', async () => {
  const pool = createNodeQueryPool(1);
  try {
    const [stuck, next] = await Promise.all([
      pool.query('while(true){}; silence', 0, 1, { timeoutMs: 700 }),
      pool.query('note(64)', 0, 1),
    ]);
    expect(stuck.error?.phase).toBe('timeout');
    expect(next).toMatchObject({ error: null, events: [{ value: { note: 64 } }] });
  } finally {
    await pool.close();
  }
  expect(() => pool.query('note(60)', 0, 1)).toThrow('Pool closed');
});
