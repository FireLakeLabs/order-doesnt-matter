import type { TurnNote } from '../live/model';
export type Size = { width: number; height: number };
export interface SpiralMark {
  id: string;
  instrument: string;
  label: string;
  lane: number;
  turn: number;
  start: number;
  from: number;
  to: number;
  startAngle: number;
  endAngle: number;
  radius: number;
  endRadius: number;
  width: number;
  opacity: number;
  onset: boolean;
  dense: boolean;
}
/** Distance of a turn's start from now. A whole playing turn stays full colour;
 * the previous turn fades over a cycle, without a discontinuity at the seam. */
export function opacityAt(cyclesFromNow: number) {
  if (cyclesFromNow < -1) {
    const x = Math.max(0, cyclesFromNow + 2);
    return x * x * (3 - 2 * x);
  }
  return cyclesFromNow <= 0 ? 1 : Math.max(0.4, 1 - cyclesFromNow * 0.3);
}
export function laneGeometry(count: number, size: Size) {
  const outer = Math.max(1, Math.min(size.width, size.height) / 2 - 24);
  const pitch = outer / 6.5;
  const spacing = pitch / (Math.max(1, count) + 1);
  return { core: pitch * 0.5, pitch, spacing, width: spacing * 0.65 };
}
/** No time quantisation except the explicitly disclosed dense occupancy fallback.
 * Each span is cut at integer turns, with just its first segment owning onset. */
export function spiralMarks(
  notes: TurnNote[],
  lanes: string[],
  now: number,
  size: Size,
): SpiralMark[] {
  const g = laneGeometry(lanes.length, size),
    indices = new Map(lanes.map((id, n) => [id, n]));
  const counts = new Map<string, number>();
  for (const n of notes) {
    const key = `${n.instrument}:${n.cycle}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dense = new Set([...counts].filter(([, n]) => n > 128).map(([key]) => key));
  const bins = new Map<string, { instrument: string; turn: number; occupied: Set<number> }>();
  const marks: SpiralMark[] = [];
  const duplicates = new Map<string, number>();
  function add(n: TurnNote, from: number, to: number, turn: number, id: string, binned: boolean) {
    const lane = indices.get(n.instrument);
    if (lane === undefined) return;
    const radius = (t: number) => g.core + g.pitch * (t - now + 2) + (lane + 1) * g.spacing;
    marks.push({
      id,
      instrument: n.instrument,
      label: n.label,
      lane,
      turn,
      start: n.cycle + n.from,
      from,
      to,
      startAngle: (from - now) * Math.PI * 2 - Math.PI / 2,
      endAngle: (to - now) * Math.PI * 2 - Math.PI / 2,
      radius: radius(from),
      endRadius: radius(to),
      width: g.width,
      opacity: opacityAt(turn - now),
      onset: !binned && from === n.cycle + n.from,
      dense: binned,
    });
  }
  for (const n of notes) {
    const start = n.cycle + n.from,
      end = n.cycle + n.to;
    const base = `${n.instrument}:${start}:${end}:${n.label}`;
    const duplicate = duplicates.get(base) ?? 0;
    duplicates.set(base, duplicate + 1);
    for (let turn = Math.floor(start); turn < Math.ceil(end); turn++) {
      const from = Math.max(start, turn),
        to = Math.min(end, turn + 1);
      if (dense.has(`${n.instrument}:${turn}`)) {
        const key = `${n.instrument}:${turn}`;
        let group = bins.get(key);
        if (!group)
          bins.set(key, (group = { instrument: n.instrument, turn, occupied: new Set() }));
        for (let b = Math.floor((from - turn) * 64); b < Math.ceil((to - turn) * 64); b++)
          group.occupied.add(b);
      } else add(n, from, to, turn, `${base}:${duplicate}:${turn}`, false);
    }
  }
  for (const { instrument, turn, occupied } of bins.values())
    for (const b of occupied)
      add(
        { instrument, cycle: turn, from: b / 64, to: (b + 1) / 64, label: 'dense' },
        turn + b / 64,
        turn + (b + 1) / 64,
        turn,
        `${instrument}:${turn}:bin:${b}`,
        true,
      );
  return marks;
}
