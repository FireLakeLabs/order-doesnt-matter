/** Cosmetic quality follows observed wall time, never the score clock. A window
 * tolerates individual fast frames amid GPU stalls; failed recovery probes back off before trying again. */
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
    headroom = 0,
    recoveryDelay = 4000,
    probing = false;
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
        if (average > 36 && level < levels.length - 1) {
          if (probing) recoveryDelay = Math.min(32000, recoveryDelay * 2);
          level++;
          headroom = 0;
        } else if (probing) recoveryDelay = 4000;
        probing = false;
      }
      if (headroom >= recoveryDelay && level > 0) {
        level--;
        probing = true;
        duration = total = samples = headroom = 0;
      }
    },
  };
}

/** Each stage observes its own cadence; a shared governor retains machine quality
 * across mounts without confusing two stages' start times or pause gaps. */
export function createFrameObserver(governor: ReturnType<typeof createQualityGovernor>) {
  let previousStart = 0,
    previousPlaying = false;
  return (started: number, cost: number, playing: boolean) => {
    const interval = previousStart && previousPlaying && playing ? started - previousStart : 0;
    governor.observe(Math.max(cost, interval), interval || cost);
    previousStart = started;
    previousPlaying = playing;
  };
}
