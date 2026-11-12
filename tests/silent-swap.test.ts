import { expect, it, vi } from 'vitest';
import type { EngineEvent } from '../src/contract';
import { engineWith, type AudioBackend, type Dispatch } from '../src/engine';
import { pending, transition } from '../src/editor/pending';
import { guarded } from '../src/strudel/audio-pattern';
import type { Pattern, State } from '../src/strudel';

it('acknowledges a current silent scheduling window once, ignoring old/stopped revisions', async () => {
  let empty!: (revision: number, cycle: number, time: number) => void;
  let trigger!: Dispatch;
  let playing = false;
  const audio: AudioBackend = {
    prepare: async () => ({
      values: [],
      commit: async () => {
        playing = true;
      },
    }),
    check: async () => {},
    resume: async () => {},
    seek: () => {},
    stop: () => {
      playing = false;
    },
    playing: () => playing,
    now: () => 4,
    time: () => 10,
    tap: { sampleRate: 48000, rms: async () => 0 },
  };
  const events: EngineEvent[] = [];
  const engine = engineWith(audio, (dispatch, _error, silent) => {
    trigger = dispatch;
    empty = silent;
  });
  engine.subscribe((event) => events.push(event));
  const first = await engine.play('silent');
  expect(events.some((e) => e.type === 'swapped')).toBe(false); // Preparation is no acknowledgement.
  empty(first, 4.25, 10.5);
  empty(first, 4.3, 10.6);
  await trigger(first, {}, 5, 12, async () => {});
  expect(events.filter((e) => e.type === 'committed')).toEqual([
    { type: 'committed', revision: first, cycle: 4.25, time: 10.5 },
  ]);
  expect(events.filter((e) => e.type === 'swapped')).toEqual([
    { type: 'swapped', revision: first, cycle: 5, time: 12 },
  ]);
  const second = await engine.play('silent again');
  empty(first, 5, 12);
  empty(second, 5.25, 12.5);
  engine.stop();
  empty(second, 6, 14);
  expect(events.filter((e) => e.type === 'committed')).toHaveLength(2);
  expect(events.at(-1)).toEqual({ type: 'transport', playing: false });
});
it('silent acknowledgement can arrive before play resolves and confirms the pending snapshot', () => {
  const doc = { version: 2 as const, body: [] };
  let state = transition(pending(doc), {
    type: 'edit',
    doc,
    target: 'row',
    token: 1,
    playing: true,
  });
  state = transition(state, { type: 'committed', revision: 2 });
  state = transition(state, { type: 'sent', doc, token: 1, revision: 2 });
  expect(state.entries).toEqual({});
  expect(state.good).toBe(doc);
});
it('guard reports onset-free windows including fragments, but never reports a failed query as silence', () => {
  const failed = vi.fn(),
    empty = vi.fn(),
    tag = vi.fn();
  const state = {
    span: { begin: 4, end: 4.1 },
    controls: { cyclist: 'cyclist' },
  } as unknown as State;
  const fragment = { hasOnset: () => false };
  const source = { query: () => [fragment] } as unknown as Pattern;
  const pattern = guarded(source, failed, tag, empty);
  pattern.query(state);
  expect(empty).toHaveBeenCalledWith(state);
  expect(tag.mock.calls[0][0]).toBe(fragment);
  empty.mockClear();
  source.query = () => {
    throw Error('broken question');
  };
  pattern.query(state);
  expect(failed).toHaveBeenCalledOnce();
  expect(empty).not.toHaveBeenCalled();
  source.query = () => [{ hasOnset: () => true }] as ReturnType<Pattern['query']>;
  pattern.query(state);
  expect(empty).not.toHaveBeenCalled();
});
