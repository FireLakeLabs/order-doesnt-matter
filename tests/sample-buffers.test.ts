import { expect, test, vi } from 'vitest';
import { createSampleLookup, type SampleSource } from '../src/strudel/sample-buffers';

function fixture() {
  const bank = ['https://samples.invalid/kick#1.wav'];
  const source: SampleSource = {
    getSound: vi.fn((sound) =>
      sound === 'bd'
        ? { data: { type: 'sample', samples: bank } }
        : sound === 'sine'
          ? { data: { type: 'synth' } }
          : undefined,
    ),
    getSampleInfo: vi.fn(() => ({ url: bank[0] })),
    getCachedBuffer: vi.fn(() => undefined),
  };
  return { source, bank, lookup: createSampleLookup(source) };
}

test('unknown and synth states never read the decoded cache or resolve a sample', () => {
  const { source, lookup } = fixture();
  expect(lookup.get('unknown', 0)).toEqual({
    status: 'unavailable',
    reason: 'Unknown sound "unknown"',
  });
  expect(lookup.get('sine', 0)).toEqual({ status: 'synth' });
  expect(source.getSampleInfo).not.toHaveBeenCalled();
  expect(source.getCachedBuffer).not.toHaveBeenCalled();
});

test('absent decoded entry is loading, resolver errors and empty banks are unavailable', () => {
  const { source, bank, lookup } = fixture();
  expect(lookup.get('bd', -1, { note: 'e4' })).toEqual({ status: 'loading' });
  expect(source.getSampleInfo).toHaveBeenCalledWith({ s: 'bd', n: -1, note: 'e4' }, bank);
  expect(source.getCachedBuffer).toHaveBeenCalledWith('https://samples.invalid/kick%231.wav');
  expect(lookup.get('bd', 0)).toEqual({ status: 'loading' });
  vi.mocked(source.getSampleInfo).mockImplementationOnce(() => {
    throw Error('empty bank');
  });
  expect(lookup.get('bd', 0)).toEqual({
    status: 'unavailable',
    reason: 'Cannot resolve sample for "bd": Error: empty bank',
  });
  vi.mocked(source.getSampleInfo).mockReturnValueOnce({ url: '' });
  expect(lookup.get('bd', 0).status).toBe('unavailable');
});

test('decoded PCM is shared and stereo peaks are computed once, including a partial final block', () => {
  const { source, lookup } = fixture();
  const channels = [
    Float32Array.from({ length: 1031 }, (_, i) => (i % 91) / 45 - 1),
    Float32Array.from({ length: 1031 }, (_, i) => 0.25 + i / 2048),
  ];
  const getChannelData = vi.fn((channel: number) => channels[channel]);
  const buffer = {
    numberOfChannels: 2,
    length: 1031,
    sampleRate: 48000,
    duration: 1031 / 48000,
    getChannelData,
  } as unknown as AudioBuffer;
  expect(lookup.get('bd', 0).status).toBe('loading');
  vi.mocked(source.getCachedBuffer).mockReturnValue(buffer);
  const result = lookup.get('bd', 0);
  if (result.status !== 'buffer') throw Error('expected buffer');
  expect(result).toMatchObject({
    frameCount: 1031,
    sampleRate: 48000,
    duration: 1031 / 48000,
    fileName: 'kick%231.wav',
  });
  channels.forEach((channel, c) => {
    expect(result.channels[c]).toBe(channel);
    for (let block = 0; block < 3; block++) {
      const data = channel.subarray(block * 512, Math.min(channel.length, (block + 1) * 512));
      expect(result.peaks.channels[c].min[block]).toBe(Math.min(...data));
      expect(result.peaks.channels[c].max[block]).toBe(Math.max(...data));
    }
  });
  expect(result.peaks.blockSize).toBe(512);
  expect(lookup.get('bd', 0)).toBe(result);
  expect(lookup.get('bd', 8)).toBe(result);
  expect(getChannelData).toHaveBeenCalledTimes(2);
  // A new decoded entry is observed; a stale handle is not pinned to sound/index.
  vi.mocked(source.getCachedBuffer).mockReturnValue({ ...buffer } as AudioBuffer);
  expect(lookup.get('bd', 0)).not.toBe(result);
});
