import { expect, test, vi } from 'vitest';
import { createTap } from '../../src/strudel/audio-tap';

test('live analyser is lazy and reuses the result and both read buffers', async () => {
  const output = { connect: vi.fn(() => node) };
  const node = { connect: () => node, gain: { value: 1 }, port: {} };
  const waveRead = vi.fn((wave: Float32Array) => wave.fill(0.25));
  const spectrumRead = vi.fn((spectrum: Uint8Array) => spectrum.fill(64));
  const analyser = {
    fftSize: 0,
    frequencyBinCount: 4096,
    smoothingTimeConstant: 1,
    getFloatTimeDomainData: waveRead,
    getByteFrequencyData: spectrumRead,
  };
  const context = {
    sampleRate: 48000,
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
    const capture = waveRead.mock.calls[0][0];
    expect(capture.length).toBe(8192);
    expect(first.wave.buffer).toBe(capture.buffer);
    expect(first.wave.byteOffset).toBe((8192 - 4800) * Float32Array.BYTES_PER_ELEMENT);
    expect(first.wave[0]).toBe(0.25);
    expect(first.spectrum[0]).toBe(64);
    expect(analyser.fftSize).toBe(8192);
    expect(analyser.smoothingTimeConstant).toBe(0);
    expect(context.createAnalyser).toHaveBeenCalledTimes(1);
    expect(output.connect).toHaveBeenCalledWith(analyser);
    expect(waveRead).toHaveBeenCalledTimes(2);
    expect(spectrumRead).toHaveBeenCalledTimes(2);
    expect(Object.keys(first).sort()).toEqual(['spectrum', 'wave']);
  } finally {
    vi.unstubAllGlobals();
  }
});
