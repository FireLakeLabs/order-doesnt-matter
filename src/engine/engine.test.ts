import { expect, test } from 'vitest';
import { engineWith } from './index';
import type { AudioBackend, Dispatch } from './index';
import type { EngineEvent } from '../contract';
function fixture() {
  let playing = false,
    revision = 0,
    dispatch!: Dispatch;
  const audio: AudioBackend = {
    async prepare(code, _from, rev) {
      if (code === 'broken') throw Error('syntax error');
      return {
        values: [{ s: code }],
        async commit() {
          playing = true;
          revision = rev;
        },
      };
    },
    check: async () => {},
    resume: async () => {},
    stop() {
      playing = false;
    },
    playing: () => playing,
    now: () => 8,
    time: () => 10,
    seek: () => {},
    tap: { sampleRate: 48000, rms: async () => 0 },
  };
  const events: EngineEvent[] = [];
  const engine = engineWith(audio, (fn) => {
    dispatch = fn;
  });
  engine.subscribe((e) => events.push(e));
  return {
    engine,
    audio,
    events,
    trigger: () => dispatch(revision, { s: 'sine' }, 8, 10, async () => {}),
  };
}
test('serialized swaps preserve transport; failed swap keeps revision and old triggers', async () => {
  const { engine, events, trigger } = fixture();
  expect(await engine.play('sine')).toBe(1);
  await trigger();
  await expect(engine.play('broken')).rejects.toThrow('syntax error');
  expect(engine.playing).toBe(true);
  await trigger();
  expect(events.filter((e) => e.type === 'trigger')).toHaveLength(2);
  expect(await engine.play('square')).toBe(2);
  await trigger();
  await trigger();
  expect(events.filter((e) => e.type === 'swapped').map((e) => e.revision)).toEqual([1, 2]);
  expect(events.filter((e) => e.type === 'transport')).toEqual([
    { type: 'transport', playing: true },
  ]);
  engine.stop();
  await trigger();
  expect(engine.now()).toBe(null);
  expect(events.at(-1)).toEqual({ type: 'transport', playing: false });
});
test('stop cancels queued playback and cannot be undone by deferred preparation', async () => {
  const { engine, audio } = fixture();
  const prepare = audio.prepare;
  let finish!: () => void;
  audio.prepare = async (...args) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return prepare(...args);
  };
  const pending = engine.play('sine');
  for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
  engine.stop();
  finish();
  await expect(pending).rejects.toThrow('cancelled');
  expect(engine.playing).toBe(false);
});
test('stop during audio resume cannot restart the transport', async () => {
  const { engine, audio } = fixture();
  let finish!: () => void;
  audio.resume = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const pending = engine.play('sine');
  for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
  engine.stop();
  finish();
  await expect(pending).rejects.toThrow('cancelled');
  expect(engine.playing).toBe(false);
});

test('section discovery reaches late sounds and caps extra work at 32 windows', async () => {
  const { engine, audio } = fixture();
  const seen: number[] = [];
  audio.discover = async (_code, starts) => {
    seen.push(...starts);
    return [{ s: 'late' }];
  };
  await engine.play('sine', { discoverCycles: Array.from({ length: 50 }, (_, i) => i * 20) });
  expect(seen).toHaveLength(32);
  expect(seen.at(-1)).toBe(620);
  expect(engine.sounds()).toContainEqual({ name: 'late', state: 'ready' });
});
