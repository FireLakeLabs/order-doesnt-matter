import type { ViewFrame } from '../types';

/** Exponential spacing keeps successive projected rings at a constant .64 ratio.
 * Camera travel is continuous in absolute score time, in either direction. */
export function tunnelPose(cycle: number, now: number, lookAhead: number) {
  const current = Math.floor(now);
  const distance = cycle - now;
  const passed = cycle < current;
  const ahead = Math.max(0, distance);
  const brightness =
    ahead < 1
      ? 1 - ahead * 0.12
      : Math.max(0.4, 0.88 - (0.48 * (ahead - 1)) / Math.max(1, lookAhead - 1));
  // One entering horizon ring fades in beyond the lookAhead fully visible rings.
  const entry = Math.max(0, Math.min(1, lookAhead + 1 - ahead));
  return {
    depth:
      Math.pow(1 / 0.64, distance + 0.4) *
      (passed ? Math.max(0.02, 1 - (now - current) / 0.25) : 1),
    brightness: passed ? Math.max(0, 1 - (now - current) / 0.25) : brightness * entry,
    passed,
  };
}
export function tunnelCycles(now: number, lookAhead: number) {
  const current = Math.floor(now);
  return Array.from({ length: Math.ceil(lookAhead) + 3 }, (_, i) => current - 1 + i).filter(
    (cycle) => cycle >= 0,
  );
}
export function nextSection(frame: Pick<ViewFrame, 'sections' | 'now'>) {
  const length = frame.sections.at(-1)?.to;
  if (!length) return undefined;
  const offset = Math.floor(frame.now / length) * length;
  const next = frame.sections.find((section) => section.from + offset > frame.now);
  return next
    ? { name: next.name, cycles: Math.ceil(next.from + offset - frame.now) }
    : { name: frame.sections[0].name, cycles: Math.ceil(length + offset - frame.now) };
}
