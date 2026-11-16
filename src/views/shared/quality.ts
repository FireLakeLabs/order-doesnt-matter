/** Cosmetic quality follows observed wall time, never the score clock. A window
 * tolerates individual fast frames amid GPU stalls; slower recovery avoids churn. */
const levels = [
  { scale: 1, bloom: true },
  { scale: 0.75, bloom: true },
  { scale: 0.5, bloom: true },
  { scale: 0.35, bloom: true },
  { scale: 0.25, bloom: false },
  { scale: 0.175, bloom: false },
] as const;
export function createQualityGovernor() {
  let level = 0,
    duration = 0,
    total = 0,
    samples = 0,
    headroom = 0;
  return {
    get quality() {
      return levels[level];
    },
    observe(frameMs: number, elapsedMs: number) {
      const elapsed = Math.min(250, Math.max(1, elapsedMs));
      duration += elapsed;
      // One compilation/GC pause cannot dominate an otherwise healthy window.
      total += Math.min(100, frameMs);
      samples++;
      headroom = frameMs < 22 ? headroom + elapsed : 0;
      if (duration >= 750) {
        const average = total / samples;
        duration = total = samples = 0;
        if (average > 33 && level < levels.length - 1) {
          level++;
          headroom = 0;
        }
      }
      if (headroom >= 4000 && level > 0) {
        level--;
        duration = total = samples = headroom = 0;
      }
    },
  };
}
