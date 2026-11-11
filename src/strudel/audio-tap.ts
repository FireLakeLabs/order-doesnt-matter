import type { OutputTap } from '../contract';
import { rms } from '../engine/logic';
import type { PCM } from '../engine/logic';

/** A rolling minute of PCM; expired or incomplete windows reject rather than claim silence. */
export async function createTap(context: AudioContext, output: AudioNode): Promise<OutputTap> {
  const url = URL.createObjectURL(
    new Blob(
      [
        `
class ODMTap extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (channels?.length) this.port.postMessage({ frame: currentFrame, channels });
    return true;
  }
}
registerProcessor('odm-output-tap', ODMTap);
`,
      ],
      { type: 'text/javascript' },
    ),
  );
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const tap = new AudioWorkletNode(context, 'odm-output-tap', { channelCount: 2 });
  const muted = context.createGain();
  muted.gain.value = 0;
  output.connect(tap).connect(muted).connect(context.destination);
  const chunks: PCM[] = [];
  tap.port.onmessage = ({ data }: MessageEvent<PCM>) => {
    chunks.push(data);
    while (chunks[0]?.frame < data.frame - context.sampleRate * 60) chunks.shift();
  };
  return {
    sampleRate: context.sampleRate,
    async rms(from, to) {
      if (!Number.isFinite(to) || to - context.currentTime > 10)
        throw Error('RMS window is too far in the future');
      const deadline = performance.now() + 11000;
      while (
        !chunks.length ||
        (chunks.at(-1)!.frame + chunks.at(-1)!.channels[0].length) / context.sampleRate < to
      ) {
        if (performance.now() > deadline)
          throw Error('Output tap timed out; audio clock may be suspended');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return rms(chunks, context.sampleRate, from, to);
    },
  };
}
