import { expect, it, vi } from 'vitest';
import { createApp } from '../src/app/controller';
import { createRetention } from '../src/app/retention';

const held = vi.hoisted(() => ({ release: [] as (() => void)[] }));
vi.mock('../src/strudel/evaluate-browser', async () => {
  const { queryEventsNode } = await import('./node-query');
  return {
    createBrowserQueries: () => ({
      async query(code: string, from: number, to: number) {
        if (code.includes('note(60)'))
          await new Promise<void>((resolve) => held.release.push(resolve));
        return queryEventsNode(code, from, to);
      },
      cancel() {},
    }),
  };
});

it('late answers from a superseded import cannot replace the new document or its score', async () => {
  const app = createApp({ retention: createRetention({ persistent: false }) });
  const first = app.load('note(60).s("sine")');
  await vi.waitFor(() => expect(held.release).toHaveLength(2));
  await app.load('note(72).s("triangle")');
  const current = app.state.doc;
  const events = app.state.events;
  held.release.splice(0).forEach((release) => release());
  await first;
  expect(app.state.doc).toBe(current);
  expect(app.state.events).toBe(events);
  expect(app.state.source).toBe('note(72).s("triangle")');
  const notes = Object.values(events).flatMap((row) => row.events);
  expect(notes.length).toBeGreaterThan(0);
  expect(notes.every((event) => (event.value as { note?: number }).note === 72)).toBe(true);
});
