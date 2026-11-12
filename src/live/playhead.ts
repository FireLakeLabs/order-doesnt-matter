/** Seconds reported by the engine, never a guessed scheduling offset. Keeping
 * this at the drawing boundary leaves the score sheet and transport untouched.
 * Unavailable context latency falls back to zero. */
export function livePlayhead(cycle: number | null, cps: number, outputLatency = 0) {
  if (cycle === null) return null;
  const seconds = Number.isFinite(outputLatency) ? Math.max(0, outputLatency) : 0;
  return cycle - seconds * cps;
}
