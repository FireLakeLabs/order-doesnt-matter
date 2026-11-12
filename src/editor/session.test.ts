import { expect, it, vi } from 'vitest';
import { importStrudel } from '../import';
import { instruments, walk, describeTarget, type Setting } from '../document';
import type { EditorContext, EditorKind } from './kind';
import { createEditSession, SWAP_THROTTLE_MS } from './session';
const setup = () => {
  const doc = importStrudel('note(60).gain(.5)').doc;
  let id = '';
  walk(doc, (n) => {
    if ('value' in n && (n as Setting).name === 'gain') id = n.id;
  });
  return { doc, id };
};
it('drag sends at most every 100ms, lands the last value and has one undo step', async () => {
  vi.useFakeTimers();
  try {
    const { doc, id } = setup();
    let revision = 0;
    const play = vi.fn(async (_doc: typeof doc) => {
        void _doc;
        return ++revision;
      }),
      refresh = vi.fn();
    const s = createEditSession(doc, { playing: () => true, play, changed: () => {}, refresh });
    s.edit(id, 0.6, 'drag');
    await vi.advanceTimersByTimeAsync(0);
    s.edit(id, 0.7, 'drag');
    s.edit(id, 0.8, 'drag');
    await vi.advanceTimersByTimeAsync(SWAP_THROTTLE_MS - 1);
    expect(play).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(play).toHaveBeenCalledTimes(2);
    expect(describeTarget(play.mock.calls[1][0], id).value).toBe(0.8);
    s.observe({ type: 'swapped', revision: 2, cycle: 0 });
    expect(s.state.entries[id].status).toBe('pending');
    s.observe({ type: 'trigger', revision: 1, instrument: instruments(doc)[0].id, cycle: 0 });
    expect(s.state.entries[id].status).toBe('pending');
    s.observe({ type: 'trigger', revision: 2, instrument: instruments(doc)[0].id, cycle: 0.5 });
    expect(s.state.entries).toEqual({});
    s.undo();
    expect(describeTarget(s.state.doc, id).value).toBe(0.5);
    expect(s.state.entries[id].status).toBe('pending');
    s.clear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(play).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
it('failed swap restores last confirmed document and visibly fails', async () => {
  const { doc, id } = setup();
  let reject!: (e: Error) => void;
  const s = createEditSession(doc, {
    playing: () => true,
    play: () =>
      new Promise((_, r) => {
        reject = r;
      }),
    changed: () => {},
    refresh: () => {},
  });
  s.edit(id, 0.9);
  reject(Error('swap refused'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(s.state.doc).toBe(doc);
  expect(s.state.entries[id].status).toBe('failed');
  s.dispose();
});
it('stopped edit is immediate and undo/redo work without scheduling playback', () => {
  const { doc, id } = setup(),
    play = vi.fn(),
    refresh = vi.fn();
  const s = createEditSession(doc, { playing: () => false, play, changed: () => {}, refresh });
  s.edit(id, 0.8);
  expect(s.state.entries).toEqual({});
  expect(play).not.toHaveBeenCalled();
  s.undo();
  expect(s.state.doc).toBe(doc);
  s.redo();
  expect(describeTarget(s.state.doc, id).value).toBe(0.8);
  expect(refresh).toHaveBeenCalledTimes(3);
});
it('a rejection after an unconfirmed commit restores engine code too and retains earlier undo', async () => {
  vi.useFakeTimers();
  try {
    const { doc, id } = setup();
    let count = 0;
    const play = vi.fn(async (_doc: typeof doc) => {
      void _doc;
      if (++count === 3) throw Error('rejected');
      return count;
    });
    const s = createEditSession(doc, {
      playing: () => true,
      play,
      changed: () => {},
      refresh: () => {},
    });
    s.edit(id, 0.6);
    await vi.advanceTimersByTimeAsync(0);
    s.observe({ type: 'swapped', revision: 1 });
    s.edit(id, 0.7);
    await vi.advanceTimersByTimeAsync(100);
    s.edit(id, 0.8);
    await vi.advanceTimersByTimeAsync(100);
    expect(describeTarget(s.state.doc, id).value).toBe(0.6);
    expect(describeTarget(play.mock.calls.at(-1)![0], id).value).toBe(0.6);
    expect(s.canUndo).toBe(true);
    s.undo();
    expect(s.state.doc).toBe(doc);
    s.dispose();
  } finally {
    vi.useRealTimers();
  }
});

it('completion from a disposed piece cannot update the new piece', async () => {
  const { doc, id } = setup();
  let resolve!: (revision: number) => void;
  const changed = vi.fn();
  const s = createEditSession(doc, {
    playing: () => true,
    play: () =>
      new Promise((r) => {
        resolve = r;
      }),
    changed,
    refresh: () => {},
  });
  s.edit(id, 0.8);
  const count = changed.mock.calls.length;
  s.dispose();
  resolve(1);
  await new Promise((r) => setTimeout(r, 0));
  expect(changed).toHaveBeenCalledTimes(count);
});

it('a fake kind applies arbitrary documents, coalesces history, and refreshes only changed isolated programs', () => {
  const doc = importStrudel('a: note(60).s("sine"); b: note(72).s("sine")').doc;
  const refresh = vi.fn();
  const s = createEditSession(doc, {
    playing: () => false,
    play: vi.fn(),
    changed: () => {},
    refresh,
  });
  const next = structuredClone(doc);
  const voice = next.body.find((n) => n.kind === 'voice' && n.name === 'a')!;
  if (voice.kind !== 'voice') throw Error('fixture');
  voice.pattern.muted = true;
  const context: EditorContext = {
    doc,
    target: describeTarget(doc, doc.body[0].id),
    window: { fromCycle: 0, toCycle: 4 },
    pending: 'none',
    apply: (doc, options) => s.apply(doc, options),
  };
  const fakeKind: EditorKind = {
    id: 'fake',
    priority: 1,
    matches: () => true,
    mount(_body, context) {
      context.apply(next, { gesture: 'fake-drag' });
      return {
        update: (context) => context.apply(context.doc, { gesture: 'fake-drag' }),
        destroy() {},
      };
    },
  };
  const mounted = fakeKind.mount({} as HTMLElement, context);
  expect(s.state.doc).toBe(next);
  expect(refresh.mock.calls[0][1]).toHaveLength(1);
  const third = {
    ...next,
    body: next.body.map((n) =>
      n === voice ? { ...voice, pattern: { ...voice.pattern, muted: false } } : n,
    ),
  };
  mounted.update({ ...context, doc: third });
  s.undo();
  expect(s.state.doc).toBe(doc);
  s.redo();
  expect(s.state.doc).toBe(third);
});

it('arbitrary playing edits use the same throttle, revision confirmation and rollback', async () => {
  vi.useFakeTimers();
  try {
    const { doc } = setup();
    let revision = 0;
    const play = vi.fn(async () => {
      if (++revision === 3) throw Error('arbitrary refused');
      return revision;
    });
    const s = createEditSession(doc, {
      playing: () => true,
      play,
      changed: () => {},
      refresh: vi.fn(),
    });
    const changed = (value: number) => ({
      ...doc,
      body: [{ kind: 'tempo' as const, id: 'tempo', tier: 1 as const, cpm: value }, ...doc.body],
    });
    s.apply(changed(30), { gesture: 'tempo-drag' });
    await vi.advanceTimersByTimeAsync(0);
    s.apply(changed(40), { gesture: 'tempo-drag' });
    s.apply(changed(50), { gesture: 'tempo-drag' });
    await vi.advanceTimersByTimeAsync(100);
    expect(play).toHaveBeenCalledTimes(2);
    s.observe({ type: 'swapped', revision: 2 });
    const confirmed = s.state.doc;
    s.apply(changed(60));
    await vi.advanceTimersByTimeAsync(100);
    expect(s.state.doc).toBe(confirmed);
    expect(Object.values(s.state.entries).every((e) => e.status === 'failed')).toBe(true);
    s.undo();
    expect(s.state.doc).toBe(doc);
    s.dispose();
  } finally {
    vi.useRealTimers();
  }
});
