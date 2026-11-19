/** Decoded source PCM, before speed, reversal, slices or effects. All arrays are
 * shared references: read-only by convention, including the peak summaries. */
export interface SampleBuffer {
  status: 'buffer';
  channels: readonly Float32Array[];
  sampleRate: number;
  duration: number;
  frameCount: number;
  url: string;
  fileName: string;
  peaks: {
    blockSize: number;
    channels: readonly { min: Float32Array; max: Float32Array }[];
  };
}
export type SampleResult =
  | SampleBuffer
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'synth' };
export interface SampleLookup {
  /** index is Strudel's n (rounded and wrapped by its resolver). Pitch selects
   * the file in note-keyed banks; omitted pitch uses Strudel's default MIDI 36.
   * Loading means no decoded entry yet, including a load that failed: the
   * upstream cache exposes neither pending promises nor failures. Never loads. */
  get(
    sound: string,
    index: number,
    pitch?: { note?: string | number; freq?: number },
  ): SampleResult;
}
export interface SampleSource {
  getSound(sound: string): { data: { type?: string; samples?: unknown } } | undefined;
  getSampleInfo(value: unknown, bank: unknown): { url: string };
  getCachedBuffer(url: string): AudioBuffer | undefined;
}
const loading = { status: 'loading' } as const;
const synth = { status: 'synth' } as const;

/** One lookup shared by opted-in stages. Peaks are computed on first request,
 * once per decoded buffer; idle frames and views without samples do no work. */
export function createSampleLookup(source: SampleSource): SampleLookup {
  const handles = new WeakMap<AudioBuffer, SampleBuffer>();
  return {
    get(sound, index, pitch) {
      const entry = source.getSound(sound);
      if (!entry) return { status: 'unavailable', reason: `Unknown sound "${sound}"` };
      if (entry.data.type !== 'sample') return synth;
      try {
        const resolved = source.getSampleInfo({ ...pitch, s: sound, n: index }, entry.data.samples);
        if (typeof resolved.url !== 'string' || !resolved.url)
          return { status: 'unavailable', reason: `No sample file for "${sound}"` };
        // Superdough 1.3.0 loadBuffer escapes the first # before caching.
        const url = resolved.url.replace('#', '%23');
        const buffer = source.getCachedBuffer(url);
        if (!buffer) return loading;
        let handle = handles.get(buffer);
        if (!handle) {
          const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
            buffer.getChannelData(channel),
          );
          const blockSize = 512;
          const peaks = channels.map((data) => {
            const min = new Float32Array(Math.ceil(data.length / blockSize));
            const max = new Float32Array(min.length);
            for (let block = 0; block < min.length; block++) {
              let lo = Infinity,
                hi = -Infinity;
              const end = Math.min(data.length, (block + 1) * blockSize);
              for (let i = block * blockSize; i < end; i++) {
                lo = Math.min(lo, data[i]);
                hi = Math.max(hi, data[i]);
              }
              min[block] = lo;
              max[block] = hi;
            }
            return { min, max };
          });
          handle = {
            status: 'buffer',
            channels,
            sampleRate: buffer.sampleRate,
            duration: buffer.duration,
            frameCount: buffer.length,
            url,
            fileName: url.split('/').at(-1)!.split('?')[0],
            peaks: { blockSize, channels: peaks },
          };
          handles.set(buffer, handle);
        }
        return handle;
      } catch (error) {
        return {
          status: 'unavailable',
          reason: `Cannot resolve sample for "${sound}": ${String(error)}`,
        };
      }
    },
  };
}
