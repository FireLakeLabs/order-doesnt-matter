import type { ViewFrame } from '../types';
import { songSummary } from '../shared/song';
import { clamp } from '../shared/math';

export interface Station {
  name: string;
  from: number;
  to: number;
  members: ReadonlySet<string>;
}
export interface Service {
  from: number;
  to: number;
  active: boolean;
}
export interface MetroScore {
  from: number;
  to: number;
  stations: Station[];
  routes: Map<string, Service[]>;
  rests: Service[];
  terminal: string;
  arranged: boolean;
}

/** Whole-score work is independent of now, theme and transient instrument flags. */
export function indexMetro(
  frame: Pick<ViewFrame, 'notes' | 'from' | 'to' | 'sections'>,
): MetroScore {
  const { notes, from, to, sections } = frame;
  const bars = songSummary(notes, from, to);
  const arranged = sections.length > 0;
  const length = sections.at(-1)?.to ?? 0;
  // The host queries the current repeat, but section times describe the first repeat.
  const offset = length > 0 ? Math.floor(from / length) * length : 0;
  const spans = arranged
    ? sections.map((section) => ({
        name: section.name,
        from: section.from + offset,
        to: section.to + offset,
      }))
    : Array.from({ length: Math.ceil((to - from) / 4) }, (_, i) => ({
        name: `Bar ${String(from + i * 4 + 1)}`,
        from: from + i * 4,
        to: Math.min(to, from + (i + 1) * 4),
      }));
  const stations = spans
    .filter((span) => span.to > from && span.from < to)
    .map((span): Station => {
      const start = Math.max(from, span.from),
        end = Math.min(to, span.to);
      const members = new Set<string>();
      for (const bar of bars) {
        if (bar.bar >= start && bar.bar + 1 <= end)
          for (const id of bar.instruments) members.add(id);
      }
      // Fractional section edges must not borrow a neighbour's membership.
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        for (const note of notes) {
          if (
            note.end > start &&
            note.start < end &&
            note.end > note.start &&
            (note.start < Math.ceil(start) || note.end > Math.floor(end))
          )
            members.add(note.instrument);
        }
      }
      return { ...span, from: start, to: end, members };
    });
  // Bar occupancy preserves late entrances (the chant in Build), without
  // turning the ordinary spaces between drum hits into exits from the line.
  const routes = new Map<string, Service[]>();
  const ids = new Set(notes.map((note) => note.instrument));
  for (const id of ids) {
    const runs: Service[] = [];
    for (const bar of bars) {
      const start = Math.max(from, bar.bar),
        end = Math.min(to, bar.bar + 1);
      const active = bar.instruments.has(id);
      const last = runs.at(-1);
      if (last?.active === active) last.to = end;
      else runs.push({ from: start, to: end, active });
    }
    routes.set(id, runs);
  }
  const rests: Service[] = [];
  const quiet = [...routes.values()].flatMap((runs) => runs.filter((run) => !run.active));
  for (const run of quiet.sort((a, b) => a.from - b.from)) {
    const last = rests.at(-1);
    if (last && last.to >= run.from) last.to = Math.max(last.to, run.to);
    else rests.push({ ...run });
  }
  return {
    from,
    to,
    stations,
    routes,
    rests,
    arranged,
    terminal: arranged ? 'End' : 'Window edge',
  };
}

export function departure(score: MetroScore, now: number, instruments: ViewFrame['instruments']) {
  const current = score.stations.findIndex((station) => now < station.to);
  const station = current < 0 ? undefined : score.stations.at(current);
  const next = current < 0 ? undefined : score.stations.at(current + 1);
  const terminal = !station || !next;
  const before = station?.members ?? new Set<string>();
  const after = next?.members ?? new Set<string>();
  const names = (test: (id: string) => boolean) =>
    instruments.filter((i) => test(i.id)).map((i) => i.name);
  return {
    name: next?.name ?? score.terminal,
    bars: Math.max(0, (next?.from ?? score.to) - clamp(now, score.from, score.to)),
    leaving: terminal && !score.arranged ? [] : names((id) => before.has(id) && !after.has(id)),
    joining: names((id) => after.has(id) && !before.has(id)),
  };
}

export interface Point {
  x: number;
  y: number;
}
/** Entry and exit remain 45°; collector legs bridge a tall bundle to its bypass
 * when a short rest cannot fit the full-height diagonals. Time always runs right. */
export function bypass(
  x0: number,
  x1: number,
  restY: number,
  activeY: number,
  leaves: boolean,
  joins: boolean,
): Point[] {
  const connections = Number(leaves) + Number(joins);
  const run = Math.min(
    Math.abs(activeY - restY),
    (Math.max(0, x1 - x0) * 0.9) / Math.max(1, connections),
  );
  const direction = Math.sign(restY - activeY);
  const left = x0 + (leaves ? run : 0);
  const right = x1 - (joins ? run : 0);
  return [
    { x: x0, y: leaves ? activeY : restY },
    { x: left, y: leaves ? activeY + direction * run : restY },
    { x: left, y: restY },
    { x: right, y: restY },
    { x: right, y: joins ? activeY + direction * run : restY },
    { x: x1, y: joins ? activeY : restY },
  ];
}

export function metroLayout(score: MetroScore, width: number, height: number, count: number) {
  const left = width * 0.065,
    right = width * 0.935;
  const scale = (right - left) / Math.max(0.001, score.to - score.from);
  const shared = count > 12;
  const legendColumns = Math.max(1, Math.floor((width - 48) / 170));
  const legendBottom = 58 + (Math.ceil(count / legendColumns) - 1) * 18;
  const top = legendBottom + 36;
  const bottom = Math.max(top + 28, height * 0.67 - 52);
  const center = (top + bottom) / 2;
  // Fill the space between the unchanged legend and board. At crowded heights
  // preserve clear gaps of 1.5 stroke widths. On very cramped stages the 3px
  // stroke floor takes priority over the gap.
  const lineWidth = Math.max(
    3,
    Math.min(
      10,
      (width * 8) / 1300,
      (bottom - top) / (2.5 * Math.max(1, count - 1) + (shared ? 0 : 1.25)),
    ),
  );
  const restOffset = shared ? 0 : lineWidth * 1.25;
  const rowTop = top + restOffset;
  const pitch = (bottom - rowTop) / Math.max(1, count - 1);
  const ys = Array.from({ length: count }, (_, i) =>
    count === 1 ? (rowTop + bottom) / 2 : rowTop + i * pitch,
  );
  const bypassY = center + (count % 2 ? pitch / 2 : 0);
  return {
    left,
    right,
    scale,
    pitch,
    shared,
    legendColumns,
    ys,
    center,
    bypassY,
    lineWidth,
    restWidth: Math.max(3, lineWidth * 0.375),
    stationWidth: Math.max(12, lineWidth * 2 + 2),
    stationFont: width < 700 ? 12 : Math.min(20, Math.max(15, (width * 16) / 1300)),
    rest: (row: number) => (shared ? bypassY : ys[row] - restOffset),
    x: (time: number) => left + (time - score.from) * scale,
    top: count === 1 ? ys[0] - restOffset : top,
    bottom: count === 1 ? ys[0] : bottom,
  };
}
