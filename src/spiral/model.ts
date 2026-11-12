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
  /** Only the final tail is shortened, by 2% of the whole note at most. */
  bodyTo: number;
  bodyEndRadius: number;
  startAngle: number;
  endAngle: number;
  radius: number;
  endRadius: number;
  width: number;
  opacity: number;
  onset: boolean;
  dense: boolean;
}
export interface ViewSettings {
  keep: number;
  upcoming: number;
}
export const defaultView: Readonly<ViewSettings> = { keep: 1, upcoming: 2 };
const storageKey = 'odm-watch-view';
type StorageRead = Pick<Storage, 'getItem'>;
type StorageWrite = Pick<Storage, 'setItem'>;
export function readView(storage?: StorageRead): ViewSettings {
  try {
    const v = JSON.parse((storage ?? localStorage).getItem(storageKey) ?? 'null');
    if (
      v &&
      Number.isFinite(v.keep) &&
      v.keep >= 0.1 &&
      v.keep <= 2 &&
      Number.isInteger(v.upcoming) &&
      v.upcoming >= 1 &&
      v.upcoming <= 4
    )
      return { keep: v.keep, upcoming: v.upcoming };
  } catch {
    /* Storage can be denied, including the property access itself. */
  }
  return { ...defaultView };
}
export function saveView(view: ViewSettings, storage?: StorageWrite) {
  try {
    (storage ?? localStorage).setItem(storageKey, JSON.stringify(view));
  } catch {
    /* optional */
  }
}
/** Playing turn stays full; smoothstep fade begins after it. Upcoming turns
 * share a 40% floor: a longer preview makes the same future turn brighter. */
export function opacityAt(cyclesFromNow: number, view: ViewSettings = defaultView) {
  if (cyclesFromNow < -1) {
    const x = Math.max(0, 1 + (cyclesFromNow + 1) / view.keep);
    return x * x * (3 - 2 * x);
  }
  return cyclesFromNow <= 0 ? 1 : Math.max(0.4, 1 - cyclesFromNow * (0.6 / view.upcoming));
}
export function laneGeometry(count: number, size: Size, view: ViewSettings = defaultView) {
  const outer = Math.max(1, Math.min(size.width, size.height) / 2 - 24);
  const pitch = outer / (view.keep + view.upcoming + 3.5);
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
  view: ViewSettings = defaultView,
): SpiralMark[] {
  const g = laneGeometry(lanes.length, size, view),
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
    const radius = (t: number) =>
      g.core + g.pitch * (t - now + view.keep + 1) + (lane + 1) * g.spacing;
    const end = n.cycle + n.to;
    const bodyTo = !binned && to === end ? Math.max(from, to - (n.to - n.from) * 0.02) : to;
    marks.push({
      id,
      instrument: n.instrument,
      label: n.label,
      lane,
      turn,
      start: n.cycle + n.from,
      from,
      to,
      bodyTo,
      bodyEndRadius: radius(bodyTo),
      startAngle: (from - now) * Math.PI * 2 - Math.PI / 2,
      endAngle: (to - now) * Math.PI * 2 - Math.PI / 2,
      radius: radius(from),
      endRadius: radius(to),
      width: g.width,
      opacity: opacityAt(turn - now, view),
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
