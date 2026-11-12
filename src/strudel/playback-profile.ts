import { query, type Pattern, type Hap } from './index';

/** Offline diagnostic over the pinned scheduler's 50 ms questions, without rendering.
 * Caller owns isolation/deadline. Tempo events update the next window, as Cyclist does.
 */
export function profilePattern(pattern: Pattern, cps: number, scale = 1, cycles = 32) {
  const windows: { begin: number; end: number; starts: number; ms: number }[] = [];
  cps *= scale;
  let errors = 0,
    firstError: string | undefined,
    anchor = 0,
    ticks = 0;
  for (let begin = 0; begin < cycles; ) {
    if (!Number.isFinite(cps) || cps <= 0) throw Error('Cannot profile a nonpositive tempo');
    const end = Math.min(cycles, anchor + ++ticks * 0.05 * cps),
      start = performance.now();
    let haps: Hap[] = [];
    try {
      haps = query(pattern, begin, end, { _cps: cps, cyclist: 'cyclist' });
    } catch (error) {
      errors++;
      firstError ??= String(error);
    }
    const ms = performance.now() - start;
    let starts = 0;
    for (const hap of haps)
      if (hap.hasOnset()) {
        starts++;
        const tempo =
          typeof hap.value === 'object' ? (hap.value as { cps?: number })?.cps : undefined;
        if (typeof tempo === 'number' && tempo * scale !== cps) {
          cps = tempo * scale;
          anchor = end;
          ticks = 0;
        }
      }
    windows.push({ begin, end, starts, ms });
    begin = end;
  }
  const ordered = windows.map((w) => w.ms).sort((a, b) => a - b);
  return {
    cycles,
    scale,
    windows,
    errors,
    firstError,
    peakStarts: Math.max(...windows.map((w) => w.starts)),
    queryMs: {
      median: ordered[Math.floor(ordered.length / 2)],
      p99: ordered[Math.ceil(ordered.length * 0.99) - 1],
      worst: ordered.at(-1),
      total: ordered.reduce((a, b) => a + b, 0),
    },
  };
}
