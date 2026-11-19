import { expect, test, vi } from 'vitest';
import { createTap } from '../src/strudel/audio-tap';

test('stereo PCM shares a corrected 100 ms span, reuses buffers and reports absent channels', async () => {
  const node = {
    gain: { value: 0 },
    port: { onmessage: vi.fn<(event: unknown) => void>() },
    connect: () => node,
  };
  const constructor = vi.fn();
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      constructor(...args: unknown[]) {
        constructor(...args);
        return node;
      }
    },
  );
  const context = {
    sampleRate: 1000,
    currentTime: 0.25,
    baseLatency: 0.02,
    outputLatency: 0.03,
    destination: node,
    createGain: () => node,
    audioWorklet: { addModule: async () => {} },
    createAnalyser: () => ({
      frequencyBinCount: 64,
      getByteFrequencyData: (spectrum: Uint8Array) => spectrum.fill(80),
    }),
  };
  try {
    const tap = await createTap(context as unknown as AudioContext, node as unknown as AudioNode);
    expect(constructor.mock.calls[0][2]).toEqual({
      channelCount: 2,
      channelCountMode: 'clamped-max',
    });
    const send = (frame: number, channels: Float32Array[], channelCount = channels.length) =>
      node.port.onmessage({ data: { frame, channels, channelCount } });
    send(0, [new Float32Array(100).fill(9), new Float32Array(100).fill(9)]);
    send(100, [
      Float32Array.from({ length: 100 }, (_, i) => i / 100),
      new Float32Array(100).fill(-0.5),
    ]);
    // Already captured future audio must not leak ahead of the corrected now.
    send(200, [new Float32Array(100).fill(8), new Float32Array(100).fill(8)]);
    const first = tap.analyse();
    const left = first.left,
      right = first.right,
      wave = first.wave;
    expect(first.channels).toBe(2);
    expect(first.complete).toBe(true);
    expect(first.endTime).toBe(0.2);
    expect(first.lagSeconds).toBeCloseTo(0);
    expect(first.left[0]).toBe(0);
    expect(first.left[99]).toBeCloseTo(0.99);
    for (let i = 0; i < 100; i++)
      expect(first.wave[i]).toBeCloseTo((first.left[i] + first.right[i]) / 2);
    // A true mono bus is left only, with no invented right-channel correlation.
    send(300, [new Float32Array(100).fill(0.75)]);
    context.currentTime = 0.45;
    const mono = tap.analyse();
    expect(mono).toBe(first);
    expect(mono.left).toBe(left);
    expect(mono.right).toBe(right);
    expect(mono.wave).toBe(wave);
    expect(mono.channels).toBe(1);
    expect(mono.right.every((v) => v === 0)).toBe(true);
    expect(mono.wave.every((v) => v === 0.75)).toBe(true);
    // Delivery age is explicit; no stretching or unstamped current-time claim.
    context.currentTime = 0.5;
    expect(tap.analyse().endTime).toBe(0.4);
    expect(first.lagSeconds).toBeCloseTo(0.05);
    send(400, [new Float32Array(100)], 0);
    context.currentTime = 0.55;
    expect(tap.analyse().channels).toBe(0);
    expect(first.left.every((v) => v === 0)).toBe(true);
    expect(first.right.every((v) => v === 0)).toBe(true);
    send(550, [new Float32Array(50).fill(0.5)]);
    context.currentTime = 0.65;
    const gap = tap.analyse();
    expect(gap.complete).toBe(false);
    expect(gap.channels).toBe(1);
    expect(gap.left[0]).toBe(0);
    expect(gap.left[99]).toBe(0.5);
  } finally {
    vi.unstubAllGlobals();
  }
});
