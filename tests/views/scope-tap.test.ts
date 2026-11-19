import { expect, test, vi } from 'vitest';
import { SPECTRUM_MIN_DB, SPECTRUM_MAX_DB } from '../../src/strudel/audio-range';
import { createTap } from '../../src/strudel/audio-tap';

test('live analyser is lazy and reuses the result and both read buffers', async () => {
  const output = { connect: vi.fn(() => node) };
  const node = { connect: () => node, gain: { value: 1 }, port: {} };
  const spectrumRead = vi.fn((spectrum: Uint8Array) => spectrum.fill(64));
  const analyser = {
    fftSize: 0,
    frequencyBinCount: 4096,
    smoothingTimeConstant: 1,
    minDecibels: -100,
    maxDecibels: -30,
    getByteFrequencyData: spectrumRead,
  };
  const context = {
    sampleRate: 48000,
    currentTime: 0,
    destination: node,
    audioWorklet: { addModule: async () => {} },
    createGain: () => node,
    createAnalyser: vi.fn(() => analyser),
  };
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      constructor() {
        return node;
      }
    },
  );
  try {
    const tap = await createTap(context as unknown as AudioContext, output as unknown as AudioNode);
    expect(context.createAnalyser).not.toHaveBeenCalled();
    const first = tap.analyse();
    const second = tap.analyse();
    expect(first).toBe(second);
    expect(first.wave).toBe(second.wave);
    expect(first.spectrum).toBe(second.spectrum);
    expect(first.wave.length / 0.1).toBe(tap.sampleRate);
    expect(first.left).toBe(second.left);
    expect(first.right).toBe(second.right);
    expect(first.left).toHaveLength(4800);
    expect(first.right).toHaveLength(4800);
    expect(first.channels).toBe(0);
    expect(first.wave.every((v) => v === 0)).toBe(true);
    expect(first.spectrum[0]).toBe(64);
    expect(analyser.fftSize).toBe(8192);
    expect(analyser.smoothingTimeConstant).toBe(0);
    expect(analyser.minDecibels).toBe(SPECTRUM_MIN_DB);
    expect(analyser.maxDecibels).toBe(SPECTRUM_MAX_DB);
    expect(analyser.maxDecibels).toBe(0);
    expect(context.createAnalyser).toHaveBeenCalledTimes(1);
    expect(output.connect).toHaveBeenCalledWith(analyser);
    expect(spectrumRead).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
