import type { AppState } from '../../app/state';
import type { EventResult } from '../../contract';
import type { Cell, Row } from '../../sheet/model';

export const LABEL_WIDTH = 300;
export const settingLaneId = (instrument: string, cell: Cell) =>
  `${instrument}:${cell.name}:${cell.nodeId}`;
export interface LaneRow {
  row: Row;
  y: number;
  height: number;
  setting?: string;
}
/** Six playing + twelve resting rows fit at 1080p. Resting rows shrink from
 * 18 to 14, then 8px before internal scrolling; playing rows never go below 44. */
export function laneRows(rows: Row[], available: number, expanded: readonly string[]): LaneRow[] {
  const playing = rows.filter((row) => !row.absent);
  const resting = rows.filter((row) => row.absent);
  const extras = rows.flatMap((row) =>
    row.cells.filter(
      (cell) => expanded.includes(settingLaneId(row.id, cell)) && cell.kind !== 'unused',
    ),
  ).length;
  const room = Math.max(0, available - extras * 28);
  const restHeight =
    playing.length * 44 + resting.length * 18 <= room
      ? 18
      : playing.length * 44 + resting.length * 14 <= room
        ? 14
        : 8;
  const height = Math.max(
    44,
    Math.min(96, (room - resting.length * restHeight) / Math.max(1, playing.length)),
  );
  let y = 0;
  return [...playing, ...resting].flatMap((row) => {
    const lane = { row, y, height: row.absent ? restHeight : height };
    y += lane.height;
    const settings = row.cells.flatMap((cell) => {
      if (!expanded.includes(settingLaneId(row.id, cell)) || cell.kind === 'unused') return [];
      const lane = { row, y, height: 28, setting: settingLaneId(row.id, cell) };
      y += 28;
      return [lane];
    });
    return [lane, ...settings];
  });
}
export function scoreRange(sections: AppState['sections'], now: number) {
  const last = sections.at(-1);
  const length = last ? last.start + last.cycles : 0;
  const offset = length ? Math.floor(now / length) * length : 0;
  const part = sections.find((s) => now - offset >= s.start && now - offset < s.start + s.cycles);
  const from = part ? offset + part.start : Math.floor(now / 4) * 4;
  return { from, to: from + (part?.cycles ?? 4), name: part?.name ?? 'Score' };
}
export const timeX = (time: number, from: number, to: number, width: number) =>
  ((time - from) / (to - from)) * width;
/** Keep the time ruler readable on long or fractional sections. Ticks label
 * absolute whole cycles, independently of note timing. */
export function rulerTicks(from: number, to: number, width: number): number[] {
  const step = Math.max(1, Math.ceil((to - from) / Math.max(1, Math.floor(width / 50))));
  const ticks: number[] = [];
  for (let cycle = Math.ceil(from); cycle < to; cycle += step)
    if (cycle === Math.ceil(from) || timeX(cycle, from, to, width) < width - 30) ticks.push(cycle);
  return ticks;
}
export const hitRow = (rows: LaneRow[], y: number) =>
  rows.find((row) => y >= row.y && y < row.y + row.height);
export interface NoteRect {
  x: number;
  y: number;
  width: number;
  height: number;
  value: unknown;
}
function pitch(value: unknown): number | undefined {
  const bag = value && typeof value === 'object' ? (value as Record<string, unknown>) : { value };
  const note = bag.note ?? bag.n ?? bag.value;
  if (typeof note === 'number' && Number.isFinite(note)) return note;
  if (typeof bag.freq === 'number' && bag.freq > 0) return 69 + 12 * Math.log2(bag.freq / 440);
  if (typeof note !== 'string') return;
  const match = /^([a-g])([#bsf]?)(-?\d+)$/i.exec(note);
  if (!match) return;
  const tones: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const semitone = tones[match[1].toLowerCase()];
  return (
    (Number(match[3]) + 1) * 12 +
    semitone +
    (['#', 's'].includes(match[2]) ? 1 : ['b', 'f'].includes(match[2]) ? -1 : 0)
  );
}
/** Whole spans are real scored time. Signals have no whole and never become notes. */
export function noteRects(
  result: EventResult | undefined,
  lane: LaneRow,
  from: number,
  to: number,
  width: number,
): NoteRect[] {
  if (!result || result.error || lane.row.absent || lane.setting) return [];
  const events = result.events.filter((e) => e.whole && e.whole[1] > from && e.whole[0] < to);
  const pitches = events.map((e) => pitch(e.value)).filter((p): p is number => p !== undefined);
  const low = Math.min(...pitches),
    high = Math.max(...pitches);
  const height = Math.min(10, Math.max(4, lane.height / 5));
  return events.map((event) => {
    const [start, end] = event.whole ?? event.part;
    const x = Math.max(0, timeX(start, from, to, width));
    const p = pitch(event.value);
    const fraction = p === undefined || low === high ? 0.5 : (p - low) / (high - low);
    return {
      x,
      width: Math.min(width - x, Math.max(3, timeX(Math.min(to, end), from, to, width) - x)),
      y: lane.y + 5 + (1 - fraction) * (lane.height - 10 - height),
      height,
      value: event.value,
    };
  });
}
export const hitNote = (notes: NoteRect[], x: number, y: number) =>
  notes.findLast(
    (note) => x >= note.x && x < note.x + note.width && y >= note.y && y < note.y + note.height,
  );
