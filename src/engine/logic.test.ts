import { expect, test } from 'vitest';
import { SoundBook, Revision, rms, soundName } from './logic';

test('sound names follow Superdough bank, default and scalar rules', () => {
  expect(soundName({ s: 'BD', bank: 'TR909' })).toBe('tr909_bd');
  expect(soundName({ note: 'c3' })).toBe('triangle');
  expect(soundName('bd')).toBe('bd');
  expect(soundName(42)).toBe('triangle');
});
test('sound state awaits decoding, combines files, and reports failures', async () => {
  const events: unknown[] = [];
  let finish!: () => void;
  const book = new SoundBook(
    async (v) => {
      if (v === 'bad') throw Error('File failed to load (offline)');
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    () => events.push(book.list()),
  );
  const work = book.observe('bd');
  expect(book.list()).toEqual([{ name: 'bd', state: 'loading' }]);
  finish();
  await work;
  expect(book.list()).toEqual([{ name: 'bd', state: 'ready' }]);
  await book.observe('bad');
  expect(book.list()[1]).toEqual({
    name: 'bad',
    state: 'missing',
    detail: 'File failed to load (offline)',
  });
  expect(events).toHaveLength(4);
});
test('one failed file keeps a bank missing when another file succeeds', async () => {
  const book = new SoundBook(
    async (v) => {
      if ((v as { n: number }).n === 1) throw Error('bad file');
    },
    () => {},
  );
  await book.observe({ s: 'bd', n: 1 });
  await book.observe({ s: 'bd', n: 0 });
  expect(book.list()[0].state).toBe('missing');
});
test('revision reports first trigger once, ignores superseded revisions', () => {
  const revision = new Revision();
  const a = revision.next(),
    b = revision.next();
  expect(revision.trigger(a)).toBe(false);
  expect(revision.trigger(b)).toBe(true);
  expect(revision.trigger(b)).toBe(false);
});
test('stereo RMS clips to exact frame boundaries and rejects absent PCM', () => {
  const chunks = [{ frame: 10, channels: [Float32Array.of(1, 0, -1), Float32Array.of(0, 1, 0)] }];
  expect(rms(chunks, 10, 1, 1.3)).toBeCloseTo(Math.sqrt(0.5));
  expect(rms(chunks, 10, 1.1, 1.2)).toBeCloseTo(Math.sqrt(0.5));
  expect(() => rms(chunks, 10, 0, 1.3)).toThrow(/captured/);
  expect(() => rms(chunks, 10, 1.3, 1)).toThrow(/window/);
});

test('tap waits for all captured frames, including delayed gaps, with a bounded failure', async () => {
  const { capturedRms } = await import('./logic');
  const chunks = [{ frame: 2, channels: [Float32Array.of(1, 1)] }];
  const work = capturedRms(chunks, 10, 0, 0.4, 100);
  setTimeout(() => chunks.unshift({ frame: 0, channels: [Float32Array.of(1, 1)] }), 10);
  expect(await work).toBe(1);
  await expect(capturedRms([], 10, 0, 0.4, 10)).rejects.toThrow(/Timed out.*frames 0–4/);
});
