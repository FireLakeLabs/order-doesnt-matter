import { expect, test } from 'vitest';
import { engineWith } from './index';
import { PlaybackNotice, PlaybackOverrun } from './playback-limits';
import type { AudioBackend, Dispatch } from './index';
import type { EngineEvent } from '../contract';
function fixture() {
  let playing = false,
    revision = 0,
    dispatch!: Dispatch,
    fail!: (error: unknown) => void;
  const audio: AudioBackend = {
    preflight: async () => [],
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
  const engine = engineWith(audio, (fn, failed) => {
    dispatch = fn;
    fail = failed;
  });
  engine.subscribe((e) => events.push(e));
  return {
    engine,
    audio,
    events,
    fail: (error: unknown) => fail(error),
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
  audio.preflight = async (_code, _from, starts) => {
    seen.push(...starts);
    return [{ s: 'late' }];
  };
  await engine.play('sine', { discoverCycles: Array.from({ length: 50 }, (_, i) => i * 20) });
  expect(seen).toHaveLength(32);
  expect(seen.at(-1)).toBe(620);
  expect(engine.sounds()).toContainEqual({ name: 'late', state: 'ready' });
});

test('preflight failure never prepares or changes first Play or the running revision', async () => {
  const { engine, audio, events, trigger } = fixture();
  const prepare = audio.prepare;
  let preparations = 0;
  audio.prepare = (...args) => {
    preparations++;
    return prepare(...args);
  };
  audio.preflight = async () => {
    throw Error('This program did not answer in time, so it was not played.');
  };
  await expect(engine.play('runaway')).rejects.toThrow('so it was not played');
  expect(engine.playing).toBe(false);
  expect(preparations).toBe(0);
  audio.preflight = async () => [];
  await engine.play('sine');
  const sounds = engine.sounds();
  audio.preflight = async () => {
    throw Error('This program did not answer in time, so it was not played.');
  };
  await expect(engine.play('runaway', { fromCycle: 16 })).rejects.toThrow('so it was not played');
  await trigger();
  expect(engine.playing).toBe(true);
  expect(engine.sounds()).toEqual(sounds);
  expect(preparations).toBe(1);
  expect(events.filter((e) => e.type === 'error')).toHaveLength(2);
  expect(events.filter((e) => e.type === 'transport')).toEqual([
    { type: 'transport', playing: true },
  ]);
  expect(events.at(-1)).toMatchObject({ type: 'swapped', revision: 1 });
});

test('a returned late query stops at the next opportunity and suppresses later triggers', async () => {
  const { engine, events, fail, trigger } = fixture();
  await engine.play('sine');
  fail(new PlaybackOverrun());
  await Promise.resolve();
  await trigger();
  expect(engine.playing).toBe(false);
  expect(events.filter((e) => e.type === 'error')).toEqual([
    { type: 'error', message: new PlaybackOverrun().message },
  ]);
  expect(events.at(-1)).toEqual({ type: 'transport', playing: false });
  expect(events.filter((e) => e.type === 'trigger')).toEqual([]);
});

test('Stop during worker preflight prevents evaluation, seeking and commit', async () => {
  const { engine, audio } = fixture();
  let finish!: (values: unknown[]) => void;
  audio.preflight = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  let prepared = false;
  audio.prepare = async () => {
    prepared = true;
    throw Error('must not evaluate');
  };
  const pending = engine.play('sine');
  for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
  engine.stop();
  finish([]);
  await expect(pending).rejects.toThrow('cancelled');
  expect(prepared).toBe(false);
  expect(engine.playing).toBe(false);
});

test('a recovering slow query remains playing and carries a notice reason, not a stop', async () => {
  const { engine, events, fail, trigger } = fixture();
  await engine.play('sine');
  fail(new PlaybackNotice('slow-query'));
  await Promise.resolve();
  await trigger();
  expect(engine.playing).toBe(true);
  expect(events.filter((e) => e.type === 'error')).toEqual([
    { type: 'error', message: new PlaybackNotice('slow-query').message, reason: 'slow-query' },
  ]);
  expect(events.filter((e) => e.type === 'transport')).toEqual([
    { type: 'transport', playing: true },
  ]);
});

test('an overrun on the initial tick keeps its stop message and emits it once', async () => {
  const { engine, audio, events, fail } = fixture();
  const prepare = audio.prepare;
  audio.prepare = async (...args) => {
    const candidate = await prepare(...args);
    return {
      ...candidate,
      async commit() {
        await candidate.commit();
        fail(new PlaybackOverrun());
      },
    };
  };
  await expect(engine.play('sine')).rejects.toThrow(new PlaybackOverrun().message);
  expect(engine.playing).toBe(false);
  expect(events.filter((e) => e.type === 'error')).toEqual([
    { type: 'error', message: new PlaybackOverrun().message },
  ]);
});
