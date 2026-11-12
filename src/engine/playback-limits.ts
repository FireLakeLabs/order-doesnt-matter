// Each Cyclist window spans 50 ms; this bounds voice creation, not query allocation.
export const MAX_WINDOW_STARTS = 32;
export const QUERY_LIMIT_MS = 50;
export const PREFLIGHT_TIMEOUT = 'This program did not answer in time, so it was not played.';
export const FLOOD_MESSAGE = `Too many notes at once. Only the first ${MAX_WINDOW_STARTS} note starts in each playback window are played.`;
export class PlaybackOverrun extends Error {
  constructor() {
    super(
      `Playback stopped because a score question took longer than ${QUERY_LIMIT_MS} milliseconds.`,
    );
  }
}
