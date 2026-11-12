import type { Step } from '../types';
import { rhythmMarks } from './rhythm-marks';
import { euclidNumbers } from './rhythm-euclid';
export interface Pulse {
  start: number;
  end: number;
  from: number;
  to: number;
  value?: string;
}
/** Literal timing only. Whole spans retain overspill; from/to are visible fragments. */
export function rhythmPulses(step: Step, from: number, to: number): Pulse[] | undefined {
  const marks = rhythmMarks(step);
  if (!marks) return;
  const shift = (events: Pulse[], scale: number, offset = 0) =>
    events.map((e) => ({
      ...e,
      start: e.start * scale + offset,
      end: e.end * scale + offset,
      from: e.from * scale + offset,
      to: e.to * scale + offset,
    }));
  function query(index: number, a: number, z: number): Pulse[] | undefined {
    // Compression can leave an interval a few ulps past an integer cycle.
    // Snap those boundaries, retaining genuinely small intervals near zero.
    const snap = (n: number) =>
      Math.abs(n - Math.round(n)) <= Number.EPSILON * Math.abs(n) * 8 ? Math.round(n) : n;
    a = snap(a);
    z = snap(z);
    if (z <= a) return [];
    if (index >= 0) {
      const op = marks!.ops[index];
      if (op.name === 'weight') return query(index - 1, a, z);
      const factor = op.name === 'slower' ? 1 / op.amount : op.amount;
      if (Math.ceil(z * factor) - Math.floor(a * factor) > 2048) return;
      if (op.name !== 'repeat') {
        const inner = query(index - 1, a * factor, z * factor);
        return inner && shift(inner, 1 / factor);
      }
      const result: Pulse[] = [];
      for (let c = Math.floor(a * factor); c < Math.ceil(z * factor); c++) {
        const source = Math.floor(c / factor),
          delta = c - source;
        const inner = query(
          index - 1,
          Math.max(a * factor, c) - delta,
          Math.min(z * factor, c + 1) - delta,
        );
        if (!inner) return;
        result.push(...shift(inner, 1 / factor, delta / factor));
      }
      return result;
    }
    const s = marks!.base,
      result: Pulse[] = [];
    for (let c = Math.floor(a); c < Math.ceil(z); c++) {
      const begin = Math.max(a, c),
        end = Math.min(z, c + 1);
      if (s.kind === 'value' || s.kind === 'rest') {
        if (s.kind === 'value' && s.chance !== undefined) return;
        result.push({
          start: c,
          end: c + 1,
          from: begin,
          to: end,
          ...(s.kind === 'value' ? { value: s.value } : {}),
        });
      } else if (s.kind === 'euclid') {
        const n = euclidNumbers(s);
        if (!n) return;
        // Distribute groups of hits and gaps until at most one remainder remains.
        let hits = Array.from({ length: n.hits }, () => [true]);
        let gaps = Array.from({ length: n.outOf - n.hits }, () => [false]);
        while (Math.min(hits.length, gaps.length) > 1) {
          const count = Math.min(hits.length, gaps.length),
            joined = hits.slice(0, count).map((h, i) => [...h, ...gaps[i]]);
          const remainder = hits.length > gaps.length ? hits.slice(count) : gaps.slice(count);
          hits = joined;
          gaps = remainder;
        }
        const pattern = [...hits, ...gaps].flat();
        for (let i = 0; i < n.outOf; i++) {
          const start = c + i / n.outOf,
            stop = c + (i + 1) / n.outOf;
          if (stop <= begin || start >= end) continue;
          const hit = pattern[(((i - n.turn) % n.outOf) + n.outOf) % n.outOf];
          const inner = hit
            ? rhythmPulses(s.step, start, stop)
            : [{ start, end: stop, from: start, to: stop }];
          if (!inner) return;
          for (const e of inner) {
            const from = Math.max(e.from, begin),
              to = Math.min(e.to, end);
            if (from < to) result.push({ ...e, start, end: stop, from, to });
          }
        }
      } else if (s.kind === 'sub' || s.kind === 'alternate' || s.kind === 'together') {
        const weights = s.steps.map((child) => rhythmMarks(child)?.weight ?? NaN);
        if (weights.some((w) => !Number.isFinite(w) || w <= 0)) return;
        if (s.kind === 'alternate' && weights.some((w) => w !== 1)) return;
        const total = weights.reduce((sum, w) => sum + w, 0);
        let offset = 0;
        for (let i = 0; i < s.steps.length; i++) {
          if (
            s.kind === 'alternate' &&
            ((c % s.steps.length) + s.steps.length) % s.steps.length !== i
          )
            continue;
          const share = s.kind === 'sub' ? weights[i] / total : 1;
          const source = s.kind === 'alternate' ? Math.floor(c / s.steps.length) : c;
          const left = Math.max(begin, c + offset),
            right = Math.min(end, c + offset + share);
          if (left < right) {
            const inner = rhythmPulses(
              s.steps[i],
              source + (left - c - offset) / share,
              source + (right - c - offset) / share,
            );
            if (!inner) return;
            result.push(...shift(inner, share, c + offset - source * share));
          }
          if (s.kind === 'sub') offset += share;
        }
      } else return;
    }
    return result;
  }
  return query(marks.ops.length - 1, from, to);
}
