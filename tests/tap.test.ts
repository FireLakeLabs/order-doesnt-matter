import { expect, it, vi } from 'vitest';
import { createTap } from '../src/strudel/audio-tap';

it('worklet capture stamps repeated Chromium frames once and retains genuine forward gaps', async () => {
  const captured: { frame: number; channels: Float32Array[] }[] = [];
  const clock = { frame: 0 };
  let Processor!: new () => { process(inputs: Float32Array[][], outputs: Float32Array[][]): void };
  const node = { gain: { value: 0 }, port: {}, connect: () => node };
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      constructor() {
        return node;
      }
    },
  );
  const context = {
    sampleRate: 48000,
    destination: node,
    createGain: () => node,
    audioWorklet: {
      async addModule(url: string) {
        const code = await (await fetch(url)).text();
        class Base {
          port = { postMessage: (data: (typeof captured)[number]) => captured.push(data) };
        }
        new Function(
          'AudioWorkletProcessor',
          'registerProcessor',
          'clock',
          code.replaceAll('currentFrame', 'clock.frame'),
        )(
          Base,
          (_name: string, type: typeof Processor) => {
            Processor = type;
          },
          clock,
        );
      },
    },
  };
  try {
    await createTap(context as unknown as AudioContext, node as unknown as AudioNode);
    const processor = new Processor();
    for (const frame of [0, 128, 128, 384, 768]) {
      clock.frame = frame;
      processor.process([[]], [[new Float32Array(128)]]);
    }
    expect(captured.map((c) => c.frame)).toEqual([0, 128, 256, 384, 768]);
    expect(captured.every((c) => c.channels[0].length === 128)).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
