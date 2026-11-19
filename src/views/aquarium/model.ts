import type { ViewFrame, ViewInstrument, ViewNote } from '../types';
import { constant, placement, stageMarks, type StageIndex } from '../soundstage/model';
import { clamp } from '../shared/math';
import { random } from '../shared/particles';

export interface Fish {
  instrument: ViewInstrument;
  voices: number;
  send: number;
  unknown: boolean;
}
export interface Request {
  instrument: ViewInstrument;
  start: number | null;
  setting: 'size' | 'feedback';
  value: number;
}
export interface Bubbles {
  instrument: ViewInstrument;
  start: number;
  count: number;
  life: number;
}
export interface Tank {
  orbit: number | null;
  fish: Fish[];
  requests: Request[];
  contested: boolean;
  bubbles: Bubbles[];
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** Soundstage owns orbit/default interpretation. Delay is another shared send. */
export function send(instrument: ViewInstrument, note?: ViewNote) {
  const p = placement(instrument, note);
  const delay = note ? note.value.delay : constant(instrument, 'delay');
  const delaySend = finite(delay) ? clamp(delay) : 0;
  return {
    orbit: p.orbit,
    reverb: p.room,
    delay: delaySend,
    amount: p.room + delaySend,
    unknown: p.unknown || (delay !== undefined && !finite(delay)),
  };
}
export function bubbleLife(amount: number) {
  return 0.45 + clamp(amount, 0, 2) * 0.45;
}
/** Inventory is exactly frame.rooms. As in Soundstage, active voices win;
 * rests retain the latest available note, never borrowing a future note's bag.
 * Requests describe scored authors, not a measured winning room state. */
export function aquarium(frame: ViewFrame, index: StageIndex) {
  const tanks: Tank[] = [...frame.rooms]
    .sort((a, b) => a.orbit - b.orbit)
    .map((r) => ({ orbit: r.orbit, fish: [], requests: [], contested: false, bubbles: [] }));
  const dry: Tank = { orbit: null, fish: [], requests: [], contested: false, bubbles: [] };
  const tankFor = (orbit: number | null, id: string) =>
    tanks.find(
      (t) => t.orbit === orbit && frame.rooms.find((r) => r.orbit === orbit)?.members.includes(id),
    );
  const samples = new Map<string, (ViewNote | undefined)[]>();
  for (const mark of stageMarks(frame, index)) {
    const id = mark.instruments[0].id;
    const list = samples.get(id) ?? [];
    list.push(...(mark.samples.length ? mark.samples : [undefined]));
    samples.set(id, list);
  }
  for (const instrument of [...frame.instruments].sort((a, b) => a.index - b.index)) {
    const bags = samples.get(instrument.id);
    if (!bags) continue;
    const groups = new Map<Tank, Fish>();
    for (const note of bags) {
      const s = send(instrument, note);
      const tank = tankFor(s.orbit, instrument.id);
      const destination = s.amount > 0 && tank ? tank : dry;
      let fish = groups.get(destination);
      if (!fish) {
        fish = { instrument, voices: 0, send: 0, unknown: false };
        groups.set(destination, fish);
        destination.fish.push(fish);
      }
      fish.voices += Number(!!note);
      fish.send = Math.max(fish.send, s.amount);
      fish.unknown ||= s.unknown || (s.amount > 0 && !tank);
      if (!tank || s.amount <= 0) continue;
      for (const [setting, value] of [
        [
          'size',
          s.reverb > 0
            ? note
              ? (note.value.size ?? note.value.roomsize)
              : (constant(instrument, 'size') ?? constant(instrument, 'roomsize'))
            : undefined,
        ],
        [
          'feedback',
          s.delay > 0
            ? note
              ? note.value.delayfeedback
              : constant(instrument, 'delayfeedback')
            : undefined,
        ],
      ] as const) {
        if (!finite(value)) continue;
        const request = { instrument, start: note?.start ?? null, setting, value };
        if (
          !tank.requests.some(
            (r) =>
              r.instrument.id === instrument.id &&
              r.start === request.start &&
              r.setting === setting &&
              r.value === value,
          )
        )
          tank.requests.push(request);
      }
    }
    if (instrument.muted) continue;
    for (const note of index.get(instrument.id) ?? []) {
      if (!note.hasOnset) continue;
      const s = send(instrument, note),
        age = frame.now - note.start,
        life = bubbleLife(s.amount);
      if (s.amount <= 0 || age < 0 || age >= life) continue;
      const tank = tankFor(s.orbit, instrument.id);
      tank?.bubbles.push({
        instrument,
        start: note.start,
        life,
        count: Math.ceil(s.amount * 10) + 1,
      });
    }
  }
  for (const tank of tanks)
    tank.contested = (['size', 'feedback'] as const).some(
      (key) => new Set(tank.requests.filter((r) => r.setting === key).map((r) => r.value)).size > 1,
    );
  return { tanks, dry };
}
export function identity(id: string) {
  let seed = 0;
  for (const char of id) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) | 0;
  return seed;
}
/** A part's swim never depends on the number of siblings or voices. */
export function swim(id: string, now: number) {
  const seed = identity(id),
    phase = random(seed) * Math.PI * 2;
  const angle = now * (0.48 + random(seed, 1) * 0.25) + phase;
  return {
    x: 0.5 + Math.sin(angle) * 0.31,
    y: 0.5 + Math.sin(angle * 0.72 + phase) * 0.29,
    facing: Math.cos(angle) >= 0 ? 1 : -1,
  };
}
export interface TankBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rooms: Tank[];
  shelf: boolean;
}
/** Above six rooms the whole inventory occupies counted miniature shelf tanks.
 * Extremely large inventories merge consecutive rooms, with exact room/fish counts. */
export function tankLayout(tanks: Tank[], dry: Tank, width: number, height: number) {
  const shelf = tanks.length > 6,
    gap = 18,
    left = 22,
    top = 82,
    bottom = height - 50;
  const onlyDry = tanks.length === 0;
  const bowlWidth = dry.fish.length
    ? onlyDry
      ? Math.min(width - left * 2, 1000)
      : Math.min(230, width * 0.25)
    : 0;
  const available = width - left * 2 - (!onlyDry && bowlWidth ? bowlWidth + gap : 0);
  const columns = Math.max(
    1,
    shelf
      ? Math.min(tanks.length, Math.floor(available / 150), 4)
      : Math.min(tanks.length, width < 700 ? 2 : 3),
  );
  const maxRows = Math.max(1, Math.floor((bottom - top) / (shelf ? 165 : 245)));
  const capacity = columns * maxRows;
  const groupSize = Math.max(1, shelf ? Math.ceil(tanks.length / capacity) : 1);
  const groups = Array.from({ length: Math.ceil(tanks.length / groupSize) }, (_, i) =>
    tanks.slice(i * groupSize, (i + 1) * groupSize),
  );
  const rows = Math.max(1, Math.ceil(groups.length / columns));
  const boxes: TankBox[] = groups.map((group, i) => ({
    x: left + ((i % columns) * (available + gap)) / columns,
    y: top + (Math.floor(i / columns) * (bottom - top + gap)) / rows,
    width: (available - gap * (columns - 1)) / columns,
    height: (bottom - top - gap * (rows - 1)) / rows,
    shelf,
    rooms: group,
  }));
  const bowl: TankBox | null = bowlWidth
    ? {
        x: onlyDry ? (width - bowlWidth) / 2 : width - left - bowlWidth,
        y: top,
        width: bowlWidth,
        height: bottom - top,
        rooms: [dry],
        shelf: false,
      }
    : null;
  return { boxes, bowl };
}

/** Dry fish occupy disjoint cells in an inset rectangle inside the curved glass.
 * Only the bowl uses this packing; wet fish retain their identity-based swim. */
export function dryBowl(box: TankBox, count: number) {
  const visible = Math.min(count, 8);
  const columns = Math.max(1, Math.ceil(Math.sqrt(visible)));
  const rows = Math.ceil(visible / columns);
  const legendRows = Math.min(count, 4);
  const footer = 27 + legendRows * 17;
  const width = Math.min(box.width, 140 + (columns - 1) * 100);
  const height = Math.min(box.height - 30 - 8 - footer, 120 + (rows - 1) * 60);
  const x = box.x + (box.width - width) / 2;
  const y = box.y + 30;
  const cellWidth = (width * 0.64) / columns;
  const cellHeight = (height * 0.6) / Math.max(1, rows);
  return {
    x,
    y,
    width,
    height,
    radius: [
      Math.min(width * 0.22, height / 2),
      Math.min(width * 0.22, height / 2),
      Math.min(width * 0.4, height / 2),
      Math.min(width * 0.4, height / 2),
    ],
    legendY: y + height + 8,
    legendRows,
    overflow: count - visible,
    paths: Array.from({ length: visible }, (_, i) => ({
      x: x + width * 0.18 + ((i % columns) + 0.5) * cellWidth,
      y: y + height * 0.18 + (Math.floor(i / columns) + 0.5) * cellHeight,
      rx: cellWidth * 0.12,
      ry: cellHeight * 0.1,
      // Fish including fins, tail, facing changes and stroke fit in ±38 × ±28.
      size: Math.min(1.1, (cellWidth * 0.76 - 6) / 76, (cellHeight * 0.8 - 6) / 56),
    })),
  };
}
export function drySwim(
  path: ReturnType<typeof dryBowl>['paths'][number],
  id: string,
  now: number,
) {
  const angle = now * 0.65 + random(identity(id)) * Math.PI * 2;
  return {
    x: path.x + Math.sin(angle) * path.rx,
    y: path.y + Math.cos(angle) * path.ry,
    facing: Math.cos(angle) >= 0 ? 1 : -1,
  };
}
