export const BROWSER_LIMIT_SECONDS = 180;
export function timingResult(start, end, limit = BROWSER_LIMIT_SECONDS) {
  const seconds = (end - start) / 1000;
  return { seconds, ok: seconds <= limit };
}
