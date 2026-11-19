// Use the playback web bundle: standalone superdough has a separate registry/cache.
import { getSound, getSampleInfo, getCachedBuffer } from '@strudel/web';
import { createSampleLookup } from './sample-buffers';

declare module '@strudel/web' {
  export function getCachedBuffer(url: string): AudioBuffer | undefined;
}

// Depends on superdough 1.3.0 sampler.mjs: getCachedBuffer reads only decoded
// AudioBuffers, populated after loadBuffer's decodeAudioData resolves. No loads,
// audio context creation or playback changes here. Real-cache browser canary:
// tests/browser/sample-buffers.spec.ts.
export function sampleBuffers(ready: () => boolean) {
  // The Studio publishes its engine only after createAudio has settled defaults().
  // Until then, an absent name is not evidence that the sound is unavailable.
  return createSampleLookup({ ready, getSound, getSampleInfo, getCachedBuffer });
}
