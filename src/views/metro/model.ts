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
  minimumRest: number;
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
  const minimumRest = quiet.reduce(
    (minimum, run) => Math.min(minimum, run.to - run.from),
    to - from,
  );
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
    minimumRest,
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
/** A resting segment peels off/joins at exactly 45 degrees. */
export function bypass(
  x0: number,
  x1: number,
  restY: number,
  activeY: number,
  leaves: boolean,
  joins: boolean,
): Point[] {
  const run = Math.abs(activeY - restY);
  return [
    { x: x0, y: leaves ? activeY : restY },
    { x: x0 + (leaves ? run : 0), y: restY },
    { x: x1 - (joins ? run : 0), y: restY },
    { x: x1, y: joins ? activeY : restY },
  ];
}

export function metroLayout(score: MetroScore, width: number, height: number, count: number) {
  const left = width * 0.065,
    right = width * 0.935;
  const scale = (right - left) / Math.max(0.001, score.to - score.from);
  const minimumSpan = score.minimumRest * scale;
  const shared = count > 12;
  const legendColumns = Math.max(1, Math.floor((width - 48) / 170));
  const legendBottom = 58 + (Math.ceil(count / legendColumns) - 1) * 18;
  const bottomLimit = height * 0.71 - 90;
  const topLimit = Math.min(bottomLimit - 28, legendBottom + 48);
  // Even two diagonals must fit within the shortest station interval.
  const pitch = Math.min(
    22,
    Math.min(height * 0.25, bottomLimit - topLimit) / Math.max(1, count),
    (minimumSpan * 0.8) / Math.max(1, count),
  );
  const half = Math.max((pitch * count) / 2, 14);
  const center = clamp(height * 0.46, topLimit + half, bottomLimit - half);
  const ys = Array.from({ length: count }, (_, i) => center + (i - (count - 1) / 2) * pitch);
  return {
    left,
    right,
    scale,
    pitch,
    shared,
    legendColumns,
    ys,
    center,
    bypassY: center + (count % 2 ? pitch / 2 : 0),
    rest: (row: number) => (shared ? center + (count % 2 ? pitch / 2 : 0) : ys[row] - pitch * 0.34),
    x: (time: number) => left + (time - score.from) * scale,
    top: center - Math.max((pitch * count) / 2, 14),
    bottom: center + Math.max((pitch * count) / 2, 14),
  };
}
