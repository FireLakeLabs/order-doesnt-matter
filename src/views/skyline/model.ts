import type { ViewFrame, ViewNote } from '../types';
import { songSummary } from '../shared/song';

export interface WindowSpan {
  start: number;
  end: number;
}
export interface Floor {
  instrument: string;
  windows: WindowSpan[];
}
export interface Building {
  bar: number;
  knownFrom: number;
  knownTo: number;
  floors: Floor[];
}
export interface City {
  from: number;
  to: number;
  arranged: boolean;
  buildings: Building[];
  districts: ViewFrame['sections'];
  starts: number[];
  maxFloors: number;
  silhouette: boolean;
}
/** Sections describe the first repeat; score coverage and notes use absolute cycles. */
export function cityRange(frame: ViewFrame): [number, number] {
  const period = frame.sections.at(-1)?.to ?? 16;
  const from = Math.max(0, Math.floor(frame.now / period)) * period;
  return [from, from + period];
}
/** Indexed only when score, row order, or the displayed repeat changes. */
export function indexCity(frame: ViewFrame): City {
  const [from, to] = cityRange(frame);
  const buckets = new Map<number, ViewNote[]>();
  for (const note of frame.notes) {
    const start = Math.max(from, frame.from, note.start);
    const end = Math.min(to, frame.to, note.end);
    for (let bar = Math.floor(start); bar < Math.ceil(end); bar++) {
      if (end <= start) break;
      const bucket = buckets.get(bar) ?? [];
      bucket.push({ ...note, start: Math.max(start, bar), end: Math.min(end, bar + 1) });
      buckets.set(bar, bucket);
    }
  }
  const rows = frame.instruments.slice().sort((a, b) => a.index - b.index);
  const buildings: Building[] = [];
  const starts: number[] = [];
  for (let bar = Math.floor(from); bar < Math.ceil(to); bar++) {
    const notes = buckets.get(bar) ?? [];
    const members = songSummary(notes, bar, bar + 1)[0].instruments;
    const byInstrument = new Map<string, WindowSpan[]>();
    for (const note of notes) {
      const windows = byInstrument.get(note.instrument) ?? [];
      windows.push({ start: note.start, end: note.end });
      byInstrument.set(note.instrument, windows);
      starts.push(note.start);
    }
    const floors = rows
      .filter((row) => members.has(row.id))
      .map((row) => ({
        instrument: row.id,
        windows: (byInstrument.get(row.id) ?? []).sort(
          (a, b) => a.start - b.start || a.end - b.end,
        ),
      }));
    buildings.push({
      bar,
      knownFrom: Math.max(bar, from, frame.from),
      knownTo: Math.min(bar + 1, to, frame.to),
      floors,
    });
  }
  return {
    from,
    to,
    arranged: frame.sections.length > 0,
    districts: frame.sections.map((s) => ({ ...s, from: s.from + from, to: s.to + from })),
    buildings,
    starts: starts.sort((a, b) => a - b),
    maxFloors: Math.max(1, ...buildings.map((b) => b.floors.length)),
    silhouette: buildings.length > 200,
  };
}
export function litCount(starts: readonly number[], now: number): number {
  let lo = 0,
    hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] <= now) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export function cityReadout(city: City, now: number) {
  const index = Math.floor(now) - Math.floor(city.from);
  const building = index >= 0 ? city.buildings.at(index) : undefined;
  const windows = building?.floors.flatMap((floor) => floor.windows) ?? [];
  return {
    lit: litCount(city.starts, now),
    total: city.starts.length,
    currentLit: windows.filter((w) => w.start <= now).length,
    currentTotal: windows.length,
  };
}
export function cityLayout(city: City, width: number, height: number, rows: number) {
  const columns = Math.max(1, Math.floor((width - 48) / 150));
  const legendRows = Math.ceil(rows / columns);
  const top = 80 + legendRows * 16;
  const street = Math.max(top + 24, height * 0.81);
  const pitch = Math.max(1, (street - top - 8) / city.maxFloors);
  const step = Math.max(0.01, (width - 48) / city.buildings.length);
  const buildingWidth = step * (city.silhouette ? 0.97 : 0.84);
  const inset = Math.min(2, buildingWidth * 0.12);
  const innerWidth = Math.max(0.01, buildingWidth - inset * 2);
  return {
    columns,
    top,
    street,
    pitch,
    step,
    buildingWidth,
    inset,
    innerWidth,
    windowHeight: Math.max(1, pitch * 0.58),
    x: (bar: number) => 24 + (bar - Math.floor(city.from)) * step,
    y: (floor: number) => street - (floor + 1) * pitch + pitch * 0.21,
  };
}
export type CityLayout = ReturnType<typeof cityLayout>;
export interface WindowInk extends WindowSpan {
  x: number;
  width: number;
}
/** A dense floor retains every window; the band is their pixel-resolution union.
 * Each pixel lights at the earliest note covering it, never at a floor-wide clock. */
export function floorInk(floor: Floor, bar: number, width: number, silhouette: boolean) {
  let end = -Infinity;
  const dense =
    silhouette ||
    floor.windows.some((w) => {
      const overlaps = w.start < end - 1e-9;
      end = Math.max(end, w.end);
      return overlaps || (w.end - w.start) * width < 1.5;
    });
  if (!dense)
    return {
      dense,
      windows: floor.windows.map((w) => ({
        ...w,
        x: (w.start - bar) * width,
        width: (w.end - w.start) * width,
      })),
    };
  const bins = new Float64Array(Math.max(1, Math.ceil(width))).fill(Infinity);
  const size = width / bins.length;
  for (const w of floor.windows) {
    const first = Math.max(0, Math.floor((w.start - bar) * bins.length));
    const last = Math.min(bins.length, Math.ceil((w.end - bar) * bins.length));
    for (let p = first; p < last; p++) bins[p] = Math.min(bins[p], w.start);
  }
  const windows: WindowInk[] = [];
  for (let p = 0; p < bins.length; p++) {
    if (!Number.isFinite(bins[p])) continue;
    const previous = windows.at(-1);
    if (
      previous &&
      previous.start === bins[p] &&
      Math.abs(previous.x + previous.width - p * size) < 1e-9
    )
      previous.width += size;
    else
      windows.push({ start: bins[p], end: bar + (p + 1) / bins.length, x: p * size, width: size });
  }
  return { dense, windows };
}
