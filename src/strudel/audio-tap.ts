import { SPECTRUM_MIN_DB, SPECTRUM_MAX_DB } from './audio-range';
import type { OutputTap } from '../contract';
import { capturedRms } from '../engine/logic';
import type { PCM } from '../engine/logic';

/** A rolling minute of PCM; expired or incomplete windows reject rather than claim silence. */
export async function createTap(context: AudioContext, output: AudioNode): Promise<OutputTap> {
  const url = URL.createObjectURL(
    new Blob(
      [
        `
class ODMTap extends AudioWorkletProcessor {
  process(inputs, outputs) {
    // Web Audio supplies zero channels for a silent input bus. Capture that
    // rendered quantum too, otherwise RMS windows crossing a voice end have gaps.
    const channels = inputs[0]?.length ? inputs[0] : [new Float32Array(outputs[0][0].length)];
    // Chromium can repeat currentFrame when the graph changes. Rendered
    // quanta still arrive in order: never stamp two captures over one another.
    const frame = Math.max(currentFrame, this.nextFrame ?? currentFrame);
    this.nextFrame = frame + outputs[0][0].length;
    this.port.postMessage({ frame, channels });
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
  let analyser: AnalyserNode;
  let timeDomain: Float32Array<ArrayBuffer>;
  let analysis: { wave: Float32Array<ArrayBuffer>; spectrum: Uint8Array<ArrayBuffer> } | undefined;
  return {
    analyse() {
      if (!analysis) {
        const node = context.createAnalyser();
        node.fftSize = 2 ** Math.ceil(Math.log2(context.sampleRate * 0.1));
        node.smoothingTimeConstant = 0;
        node.minDecibels = SPECTRUM_MIN_DB;
        node.maxDecibels = SPECTRUM_MAX_DB;
        output.connect(node);
        analyser = node;
        timeDomain = new Float32Array(node.fftSize);
        analysis = {
          // Keep the newest 100 ms of the FFT capture, without copying it.
          wave: timeDomain.subarray(node.fftSize - Math.round(context.sampleRate * 0.1)),
          spectrum: new Uint8Array(node.frequencyBinCount),
        };
      }
      analyser.getFloatTimeDomainData(timeDomain);
      analyser.getByteFrequencyData(analysis.spectrum);
      return analysis;
    },
    sampleRate: context.sampleRate,
    async rms(from, to) {
      if (!Number.isFinite(to) || to - context.currentTime > 10)
        throw Error('RMS window is too far in the future');
      return capturedRms(chunks, context.sampleRate, from, to);
    },
  };
}
