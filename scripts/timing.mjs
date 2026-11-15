export const BROWSER_WARN_SECONDS = 300;
export const NODE_WARN_SECONDS = 60;
export function timingResult(start, end, threshold = BROWSER_WARN_SECONDS) {
  const seconds = (end - start) / 1000;
  return { seconds, warning: seconds > threshold };
}
export function formatTiming(name, result, threshold) {
  return `${result.warning ? 'WARNING: ' : ''}${name} suite: ${result.seconds.toFixed(3)} s / ${threshold} s warning threshold${result.warning ? ' — exceeded (informational)' : ''}`;
}
