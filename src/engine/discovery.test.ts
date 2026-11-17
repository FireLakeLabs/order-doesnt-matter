import { expect, test, vi } from 'vitest';
import { engineWith, type AudioBackend } from './index';

function fixture() {
  let playing = false;
  const registry = { epoch: 0, trusted: true };
  const audio: AudioBackend = {
    preflight: vi.fn(async (_code, _from, starts) => ({
      values: [{ s: 'current' }, ...(starts.length ? [{ s: 'late', n: 2 }] : [])],
      discoveryValues: starts.length ? [{ s: 'late', n: 2 }] : [],
    })),
    prepare: vi.fn(async () => ({
      values: [{ s: 'now' }],
      commit: async () => {
        playing = true;
      },
    })),
    check: vi.fn(async () => {}),
    resume: async () => {},
    stop: () => {
      playing = false;
    },
    playing: () => playing,
    now: () => 0,
    time: () => 0,
    outputLatency: () => 0,
    seek: () => {},
    tap: {
      sampleRate: 48000,
      analyse: () => {
        throw Error('Unused fake analysis');
      },
      rms: async () => 0,
    },
  };
  const engine = engineWith(audio, () => {}, registry);
  const options = { discoverCycles: [0, 40], discovery: { scope: {}, identity: 'pure' } };
  const starts = () => vi.mocked(audio.preflight).mock.calls.map((c) => c[2]);
  return { engine, audio, options, starts, registry };
}

test('only extra discovery is saved; every fresh SoundBook still checks late indexed values', async () => {
  const { engine, audio, options, starts } = fixture();
  for (const code of ['700', '900', '700']) {
    await engine.play(code, options);
    expect(engine.sounds()).toEqual([
      { name: 'now', state: 'ready' },
      { name: 'current', state: 'ready' },
      { name: 'late', state: 'ready' },
    ]);
  }
  expect(starts()).toEqual([[0, 40], [], []]);
  expect(audio.prepare).toHaveBeenCalledTimes(3);
  expect(
    vi.mocked(audio.check).mock.calls.filter(([v]) => (v as { s: string }).s === 'late'),
  ).toEqual(Array(3).fill([{ s: 'late', n: 2 }]));
  engine.stop();
});

for (const reset of [
  'identity',
  'scope',
  'coverage',
  'stop',
  'registry',
  'unknown',
  'error',
  'commit',
] as const)
  test(`inventory resets after ${reset} without replacing the last good book on failure`, async () => {
    const { engine, audio, options, starts, registry } = fixture();
    await engine.play('old', options);
    const good = engine.sounds();
    if (reset === 'identity') options.discovery.identity = 'different';
    if (reset === 'scope') options.discovery.scope = {};
    if (reset === 'coverage') options.discoverCycles = [0, 80];
    if (reset === 'stop') engine.stop();
    if (reset === 'registry') registry.epoch++;
    if (reset === 'unknown') await engine.play('side effects');
    if (reset === 'error') {
      vi.mocked(audio.preflight).mockRejectedValueOnce(Error('failed preflight'));
      await expect(engine.play('bad', options)).rejects.toThrow('failed preflight');
      expect(engine.sounds()).toEqual(good);
      expect(engine.playing).toBe(true);
    }
    if (reset === 'commit') {
      vi.mocked(audio.prepare).mockResolvedValueOnce({
        values: [],
        commit: async () => {
          throw Error('failed commit');
        },
      });
      await expect(engine.play('bad', options)).rejects.toThrow('failed commit');
      expect(engine.sounds()).toEqual(good);
      expect(engine.playing).toBe(true);
    }
    await engine.play('next', options);
    expect(starts().at(-1)).toEqual(options.discoverCycles);
    engine.stop();
  });

test('Stop during discovery discards stale inventory; new engine has no old inventory', async () => {
  const { engine, audio, options, starts } = fixture();
  let finish!: (v: { values: unknown[]; discoveryValues: unknown[] }) => void;
  vi.mocked(audio.preflight).mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const pending = engine.play('stale', options);
  await vi.waitFor(() => expect(finish).toBeDefined());
  engine.stop();
  finish({ values: [{ s: 'stale' }], discoveryValues: [{ s: 'stale' }] });
  await expect(pending).rejects.toThrow('cancelled');
  await engine.play('new', options);
  expect(starts()).toEqual([
    [0, 40],
    [0, 40],
  ]);
  expect(engine.sounds().some((s) => s.name === 'stale')).toBe(false);
  const other = engineWith(audio, () => {});
  await other.play('another engine', options);
  expect(starts().at(-1)).toEqual([0, 40]);
  other.stop();
  engine.stop();
});

test('a registry mutation during in-flight reuse rejects safely and requires fresh discovery', async () => {
  const { engine, audio, registry, starts, options } = fixture();
  await engine.play('first', options);
  const good = engine.sounds();
  vi.mocked(audio.preflight).mockImplementationOnce(async () => {
    registry.epoch++;
    return { values: [], discoveryValues: [] };
  });
  await expect(engine.play('stale', options)).rejects.toThrow('inventory changed');
  expect(engine.sounds()).toEqual(good);
  await engine.play('fresh', options);
  expect(starts().at(-1)).toEqual([0, 40]);
  engine.stop();
});
