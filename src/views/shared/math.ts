/** Bound a number inclusively; defaults to the unit interval. */
export const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
