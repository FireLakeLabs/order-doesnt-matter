// Census: all 85 corpus programs, 32 cycles at own/double tempo, peak 49.
export const MAX_WINDOW_STARTS = 512;
// 32-cycle audio-pattern profiles at ×1/×4/×6: throttled worst 68.1 ms.
export const LATE_QUERY_MS = 250;
export const HARD_QUERY_MS = 2_000;
export const LATE_WINDOWS = 4;
export const PREFLIGHT_TIMEOUT = 'This program did not answer in time, so it was not played.';
export const FLOOD_MESSAGE = 'Too many notes at once — some were left out. Playback continues.';
export const SLOW_MESSAGE = 'The score took a little longer to answer. Playback continues.';
export class PlaybackNotice extends Error {
  reason: 'notes-left-out' | 'slow-query';
  constructor(reason: 'notes-left-out' | 'slow-query') {
    super(reason === 'notes-left-out' ? FLOOD_MESSAGE : SLOW_MESSAGE);
    this.reason = reason;
  }
}
export class PlaybackOverrun extends Error {
  constructor() {
    super('This program is taking too long to answer, so playback was stopped.');
  }
}
export class QueryBudget {
  private late = 0;
  private warned = false;
  observe(ms: number): PlaybackNotice | PlaybackOverrun | undefined {
    this.late = ms > LATE_QUERY_MS ? this.late + 1 : 0;
    if (ms > HARD_QUERY_MS || this.late >= LATE_WINDOWS) return new PlaybackOverrun();
    if (this.late && !this.warned) {
      this.warned = true;
      return new PlaybackNotice('slow-query');
    }
  }
}
