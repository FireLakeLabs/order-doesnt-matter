/** Attach before a whole cycle, so an onset-zero flash cannot outlive the
 * prediction window that owns it. Count-in and exactly zero both start at zero. */
export function liveObservationWindow(cycle: number) {
  const from = Math.max(0, Math.ceil(cycle));
  return { from, to: from + 2 };
}
