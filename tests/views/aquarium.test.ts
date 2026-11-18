import { beforeAll, expect, it } from 'vitest';
import type { ViewFrame, ViewNote } from '../../src/views/types';
import { aquarium, bubbleLife, send, swim, tankLayout } from '../../src/views/aquarium/model';
import { indexStage } from '../../src/views/soundstage/model';
import { soundstageCorpusFrame } from './soundstage.fixture';
import { scoreFrame } from './score-fixture';
let real: ViewFrame, conflict: ViewFrame, delay: ViewFrame;
beforeAll(async () => {
  [real, conflict, delay] = await Promise.all([
    soundstageCorpusFrame(),
    soundstageCorpusFrame('micro-orbit-conflict', 0.4),
    soundstageCorpusFrame('micro-orbit-delay', 0.4),
  ]);
});
const state = (f: ViewFrame) => aquarium(f, indexStage(f.notes));
const note = (instrument: string, value: ViewNote['value'], start = 10, end = 11): ViewNote => ({
  instrument,
  value,
  start,
  end,
  hasOnset: true,
});
it('maps dubstep b11:40% to one shared stirred tank and four dry fish', () => {
  const { tanks, dry } = state(real);
  expect(tanks).toHaveLength(1);
  expect(tanks[0].orbit).toBe(1);
  expect(tanks[0].fish.map((f) => f.instrument.name)).toEqual(['sd · drop', 'wobbleBass']);
  expect(dry.fish.map((f) => f.instrument.name)).toEqual(['bd', 'hh · drop', 'oh', 'subBass']);
  expect(tanks[0].requests.map((r) => [r.instrument.name, r.start, r.setting, r.value])).toEqual([
    ['sd · drop', 9.5, 'size', 0.7],
  ]);
  expect(tanks[0].contested).toBe(false);
});
it('shows the real conflicting orbit and both roomsize authors, with no inferred winner', () => {
  const { tanks, dry } = state(conflict);
  expect(tanks).toHaveLength(1);
  expect(tanks[0].orbit).toBe(0);
  expect(tanks[0].fish).toHaveLength(2);
  expect(tanks[0].contested).toBe(true);
  expect(tanks[0].requests.map((r) => r.value)).toEqual([2, 8]);
  expect(dry.fish).toHaveLength(0);
});
it('includes delay-only sends and feedback requests, preserving the host inventory exactly', () => {
  expect(state(delay).tanks.map((t) => t.orbit)).toEqual(delay.rooms.map((r) => r.orbit));
  expect(state(delay).tanks.every((t) => t.fish.length > 0)).toBe(true);
  const f = scoreFrame(2);
  f.rooms = [
    { orbit: 2, members: ['0', '1'] },
    { orbit: 7, members: [] },
  ];
  f.notes = [
    note('0', { orbit: 2, delay: 0.5, delayfeedback: 0.3 }),
    note('1', { orbit: 2, delay: 1, delayfeedback: 0.8 }),
  ];
  expect(state(f).tanks[0]).toMatchObject({ contested: true, fish: [{ send: 0.5 }, { send: 1 }] });
  expect(state(f).tanks[1].fish).toEqual([]);
  expect(state({ ...f, rooms: [] }).tanks).toEqual([]);
  expect(state({ ...f, rooms: [] }).dry.fish.every((p) => p.unknown)).toBe(true);
});
it('uses present bags before metadata, never future notes, and keeps split-orbit voices counted', () => {
  const f = scoreFrame();
  f.instruments[0].room = 1;
  f.instruments[0].settings = [{ name: 'room', label: 'Room', kind: 'constant', value: 0.9 }];
  f.rooms = [
    { orbit: 1, members: ['0'] },
    { orbit: 2, members: ['0'] },
  ];
  f.notes = [note('0', { room: 1 }, 11, 12)];
  expect(state(f).tanks[0].fish[0].send).toBe(0.9);
  f.notes.push(note('0', {}));
  expect(state(f).dry.fish).toHaveLength(1);
  f.notes = [note('0', { orbit: 1, room: 0.2 }), note('0', { orbit: 2, room: 0.8 })];
  expect(state(f).tanks.map((t) => t.fish[0].voices)).toEqual([1, 1]);
  expect(send(f.instruments[0], note('0', { FX: { room: 1 } })).amount).toBe(0);
});
it('bubbles only on reached onsets, increase with send, retain dense counts, and ignore fragments', () => {
  const f = scoreFrame();
  f.now = 10.1;
  f.rooms = [{ orbit: 1, members: ['0'] }];
  f.notes = Array.from({ length: 500 }, () => note('0', { room: 0.8 }));
  const full = state(f);
  expect(full.tanks[0].fish[0].voices).toBe(500);
  expect(full.tanks[0].bubbles).toHaveLength(500);
  expect(full.tanks[0].bubbles.reduce((n, b) => n + b.count, 0)).toBe(4500);
  f.notes = [note('0', { room: 0.2 }), note('0', { room: 0.8 })];
  expect(state(f).tanks[0].bubbles.map((b) => b.count)).toEqual([3, 9]);
  expect(bubbleLife(0.8)).toBeGreaterThan(bubbleLife(0.2));
  f.notes.push({ ...f.notes[0], hasOnset: false });
  expect(state(f).tanks[0].bubbles).toHaveLength(2);
  expect(state({ ...f, now: 9 }).tanks[0].bubbles).toEqual([]);
  expect(state({ ...f, now: 12 }).tanks[0].bubbles).toEqual([]);
  expect(
    state({ ...f, instruments: f.instruments.map((i) => ({ ...i, muted: true })) }).tanks[0]
      .bubbles,
  ).toEqual([]);
});
it('keeps analytic swim identity when siblings end, and accounts for all rooms on narrow shelves', () => {
  const original = swim('held', 10.4);
  swim('other', 1);
  swim('held', 2);
  expect(swim('held', 10.4)).toEqual(original);
  for (const count of [1, 6, 7, 20, 100]) {
    const f = scoreFrame(20);
    f.rooms = Array.from({ length: count }, (_, orbit) => ({
      orbit,
      members: f.instruments.map((i) => i.id),
    }));
    f.notes = f.instruments.map((i) => note(i.id, { room: 0.8, orbit: i.index % count }));
    const model = state(f);
    for (const [width, height] of [
      [1300, 760],
      [560, 675],
      [1131, 469],
    ]) {
      const box = tankLayout(model.tanks, model.dry, width, height);
      expect(box.boxes.flatMap((b) => b.rooms)).toHaveLength(count);
      expect(
        box.boxes.every(
          (b) =>
            b.width > 80 &&
            b.height > 100 &&
            b.x + b.width <= width - 20 &&
            b.y + b.height < height - 30,
        ),
      ).toBe(true);
      if (count <= 7) expect(box.boxes).toHaveLength(count);
      else expect(box.boxes.every((b) => b.shelf)).toBe(true);
    }
  }
});
