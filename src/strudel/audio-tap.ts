import { SPECTRUM_MIN_DB, SPECTRUM_MAX_DB } from './audio-range';
import type { OutputTap } from '../contract';
import { capturedRms } from '../engine/logic';
import type { PCM } from '../engine/logic';

type StereoAnalysis = {
  wave: Float32Array<ArrayBuffer>;
  spectrum: Uint8Array<ArrayBuffer>;
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
  channels: 0 | 1 | 2;
  complete: boolean;
  sampleRate: number;
  endTime: number;
  lagSeconds: number;
};
type StereoTap = Omit<OutputTap, 'analyse'> & { analyse(): StereoAnalysis };

/** A rolling minute of PCM; expired or incomplete windows reject rather than claim silence. */
export async function createTap(context: AudioContext, output: AudioNode): Promise<StereoTap> {
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
    this.port.postMessage({ frame, channels, channelCount: inputs[0]?.length ?? 0 });
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
  // Cap input at two channels while retaining genuine mono and absent buses.
  const tap = new AudioWorkletNode(context, 'odm-output-tap', {
    channelCount: 2,
    channelCountMode: 'clamped-max',
  });
  const muted = context.createGain();
  muted.gain.value = 0;
  output.connect(tap).connect(muted).connect(context.destination);
  const chunks: (PCM & { channelCount: number })[] = [];
  tap.port.onmessage = ({ data }: MessageEvent<PCM & { channelCount: number }>) => {
    chunks.push(data);
    while (chunks[0]?.frame < data.frame - context.sampleRate * 60) chunks.shift();
  };
  let analyser: AnalyserNode;
  let analysis: StereoAnalysis | undefined;
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
        analysis = {
          wave: new Float32Array(Math.round(context.sampleRate * 0.1)),
          left: new Float32Array(Math.round(context.sampleRate * 0.1)),
          right: new Float32Array(Math.round(context.sampleRate * 0.1)),
          channels: 0,
          complete: false,
          sampleRate: context.sampleRate,
          endTime: 0,
          lagSeconds: 0,
          spectrum: new Uint8Array(node.frequencyBinCount),
        };
      }
      // Read all three PCM buffers from the same worklet span. Unlike separate
      // analyser reads this also preserves the actual input channel count.
      const corrected = Math.max(
        0,
        context.currentTime - (context.baseLatency ?? 0) - (context.outputLatency ?? 0),
      );
      const latest = chunks.at(-1);
      const end = Math.min(
        Math.floor(corrected * context.sampleRate),
        latest ? latest.frame + latest.channels[0].length : 0,
      );
      const begin = end - analysis.wave.length;
      analysis.left.fill(0);
      analysis.right.fill(0);
      analysis.wave.fill(0);
      analysis.channels = 0;
      analysis.endTime = end / context.sampleRate;
      analysis.lagSeconds = Math.max(0, corrected - analysis.endTime);
      let captured = 0;
      for (let c = chunks.length - 1; c >= 0; c--) {
        const chunk = chunks[c];
        if (chunk.frame + chunk.channels[0].length <= begin) break;
        if (chunk.frame >= end) continue;
        analysis.channels = Math.max(analysis.channels, chunk.channelCount) as 0 | 1 | 2;
        const from = Math.max(begin, chunk.frame);
        const to = Math.min(end, chunk.frame + chunk.channels[0].length);
        captured += to - from;
        for (let frame = from; frame < to; frame++) {
          const i = frame - begin;
          const j = frame - chunk.frame;
          const left = chunk.channels[0][j];
          const right = chunk.channels[1]?.[j] ?? 0;
          analysis.left[i] = left;
          analysis.right[i] = right;
          analysis.wave[i] = chunk.channelCount === 2 ? (left + right) / 2 : left;
        }
      }
      analysis.complete = captured === analysis.wave.length;
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
