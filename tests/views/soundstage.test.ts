import { beforeAll, expect, it } from 'vitest';
import type { ViewFrame, ViewNote } from '../../src/views/types';
import {
  indexStage,
  placement,
  roomRugs,
  roomCaptions,
  stageMarks,
} from '../../src/views/soundstage/model';
import { radiusOf, stageBox, stageLayout, truePlace } from '../../src/views/soundstage/geometry';
import { scoreFrame } from './score-fixture';
import { soundstageCorpusFrame } from './soundstage.fixture';

let real: ViewFrame, pan: ViewFrame, jux: ViewFrame, delay: ViewFrame;
beforeAll(async () => {
  [real, pan, jux, delay] = await Promise.all([
    soundstageCorpusFrame(),
    soundstageCorpusFrame('micro-signal-lanes'),
    soundstageCorpusFrame('mms-jux'),
    soundstageCorpusFrame('micro-orbit-delay'),
  ]);
});
const note = (
  start: number,
  end: number,
  value: ViewNote['value'] = {},
  instrument = '0',
): ViewNote => ({ instrument, start, end, value, hasOnset: true });
const current = (f: ViewFrame) => stageMarks(f, indexStage(f.notes));
it('places the real dubstep section on the centre line with honest send depth and gain', () => {
  const marks = current(real);
  expect(marks).toHaveLength(6);
  for (const mark of marks) expect(mark.pan).toBe(0.5);
  const named = Object.fromEntries(marks.map((m) => [m.instruments[0].name, m]));
  expect(named.wobbleBass.room).toBe(0.25);
  expect(named.wobbleBass.gain).toBe(0.75);
  expect(named['sd · drop'].room).toBe(0.45);
  expect(named['sd · drop'].gain).toBe(1);
  for (const name of ['bd', 'hh · drop', 'oh', 'subBass']) expect(named[name].room).toBe(0);
  expect(named.subBass.held).toBe(true);
  expect(named.bd.held).toBe(false);
  expect(named['hh · drop'].gain).toBeCloseTo(0.5765772915618641);
});
it('uses host room membership and names the actual scored room-size requester', () => {
  const rugs = roomRugs(real, current(real));
  expect(rugs).toHaveLength(1);
  expect(rugs[0].orbit).toBe(1);
  expect(rugs[0].marks.map((m) => m.instruments[0].name)).toEqual(['sd · drop', 'wobbleBass']);
  expect(rugs[0].requests.map((r) => [r.instrument.name, r.size])).toEqual([['sd · drop', 0.7]]);
  expect(roomRugs({ ...real, rooms: [] }, current(real))).toEqual([]);
});
it('samples real patterned pan once per note and seeks reversibly', () => {
  const index = indexStage(pan.notes);
  const at = (now: number) => stageMarks({ ...pan, now }, index)[0];
  expect(at(10.05).pan).toBeCloseTo(1);
  expect(at(10.2).pan).toBeCloseTo(1);
  expect(at(10.3).pan).toBeCloseTo(0.5);
  expect(at(10.55).pan).toBeCloseTo(0);
  expect(at(10.05).pan).toBeCloseTo(1);
});
it('retains both actual sides of a jux instrument rather than averaging its voices', () => {
  const marks = current(jux);
  expect(new Set(marks.map((m) => m.pan))).toEqual(new Set([0, 1]));
  expect(marks.reduce((sum, m) => sum + m.count, 0)).toBe(
    jux.notes.filter((n) => n.hasOnset && n.start <= jux.now && n.end > jux.now).length,
  );
});
it('never takes a future note or a metadata override over a current sampled bag', () => {
  const f = scoreFrame();
  f.instruments[0].settings = [
    { name: 'pan', label: 'Pan', kind: 'constant', value: 0.9 },
    { name: 'room', label: 'Room', kind: 'constant', value: 0.7 },
  ];
  f.notes = [note(11, 12, { pan: 0 })];
  expect(current(f)[0].pan).toBe(0.9);
  f.notes.push(note(10, 11));
  expect(current(f)[0].pan).toBe(0.5);
  expect(current(f)[0].room).toBe(0);
  expect(placement(f.instruments[0], note(0, 1, { pan: -2, room: 3, gain: 10 }))).toMatchObject({
    pan: 0,
    room: 1,
    gain: 2,
  });
});
it('keeps a long held voice alongside later notes and excludes matching fragment copies', () => {
  const f = scoreFrame();
  const held = note(0, 20, { pan: 0.25 });
  f.notes = [held, { ...held, hasOnset: false }, note(10, 10.2, { pan: 1 })];
  expect(current(f)).toHaveLength(1);
  expect(current(f)[0]).toMatchObject({ pan: 0.25, held: true, count: 1 });
  f.instruments[0].muted = true;
  expect(current(f)[0].held).toBe(false);
});
it('counts all 500 coincident voices and shows all scattered placements in a counted range', () => {
  const f = scoreFrame();
  f.notes = Array.from({ length: 500 }, () => note(10, 11, { gain: 0.5 }));
  expect(current(f)).toHaveLength(1);
  expect(current(f)[0].count).toBe(500);
  f.notes.forEach((n, i) => {
    n.value.pan = i / 499;
    n.value.room = i / 499;
  });
  expect(current(f)).toHaveLength(1);
  expect(current(f)[0].positions).toHaveLength(500);
  expect(current(f)[0].pan).toBeCloseTo(0.5, 10);
  expect(current(f)[0].room).toBeCloseTo(0.5, 10);
  expect(current(f)[0].count).toBe(500);
});
it('fans overlapping real markers with unchanged true positions at both desktop sizes and Stage B', () => {
  for (const [width, height] of [
    [1299, 674.5],
    [1131.25, 469.09],
    [559, 674.5],
  ]) {
    const f = { ...real, width, height },
      marks = current(f);
    const { box, spots } = stageLayout(f, marks, (s) => s.length * 7);
    expect(spots).toHaveLength(6);

    for (const s of spots.filter((s) => s.mark.room === 0))
      expect(Math.abs(s.y - s.trueY)).toBeLessThan(2);
    for (const s of spots) {
      expect(s.trueX).toBe(truePlace(box, s.mark.pan, s.mark.room).x);
      expect(s.trueY).toBe(truePlace(box, s.mark.pan, s.mark.room).y);
      expect(s.x - s.radius).toBeGreaterThanOrEqual(box.left);
      expect(s.x + s.radius).toBeLessThanOrEqual(box.right);
      expect(s.y - s.radius).toBeGreaterThanOrEqual(box.top);
      expect(s.y + s.radius + (s.compact ? 15 : 29)).toBeLessThanOrEqual(box.bottom);
    }
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++)
        expect(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y)).toBeGreaterThanOrEqual(
          spots[i].radius + spots[j].radius,
        );
    expect(spots.some((s) => s.x !== s.trueX || s.y !== s.trueY)).toBe(true);
  }
});
it('uses the same pan/send geometry regardless of names or note order, and gain alone sets radius', () => {
  const f = scoreFrame(2);
  f.notes = [
    note(10, 11, { pan: 0.2, room: 0.8, gain: 0.25 }),
    note(10, 11, { pan: 0.8, room: 0.1, gain: 1 }, '1'),
  ];
  const original = current(f);
  f.instruments[0].name = 'kick';
  f.instruments[1].name = 'bass';
  f.notes.reverse();
  expect(current(f).map((m) => [m.pan, m.room, m.gain])).toEqual(
    original.map((m) => [m.pan, m.room, m.gain]),
  );
  expect(radiusOf(f, 1)).toBeGreaterThan(radiusOf(f, 0.25));
  const box = stageBox(f);
  expect(truePlace(box, 0.2, 0.8).x).toBeLessThan(truePlace(box, 0.8, 0.1).x);
  expect(truePlace(box, 0.2, 0.8).y).toBeLessThan(truePlace(box, 0.8, 0.1).y);
});
it('keeps one and twenty in-section instruments inside a narrow stage', () => {
  for (const count of [1, 20]) {
    const f = { ...scoreFrame(count), width: 559, height: 675 };
    f.notes = f.instruments.map((i) => note(10, 11, {}, i.id));
    const { box, spots } = stageLayout(f, current(f), (s) => s.length * 7);
    expect(spots).toHaveLength(count);
    expect(
      spots.every(
        (s) =>
          s.x - s.radius >= box.left &&
          s.x + s.radius <= box.right &&
          s.y - s.radius >= box.top &&
          s.y + s.radius < box.bottom,
      ),
    ).toBe(true);
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++)
        expect(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y)).toBeGreaterThanOrEqual(
          spots[i].radius + spots[j].radius,
        );
  }
});

it('draws a lone dry instrument exactly on the front row at every gain and stage size', () => {
  for (const [width, height] of [
    [1299, 673],
    [1131.25, 467.59],
    [559, 673],
  ])
    for (const gain of [0, 0.5, 1, 2]) {
      const f = { ...scoreFrame(), width, height };
      f.notes = [note(10, 11, { gain })];
      const { spots } = stageLayout(f, current(f), (s) => s.length * 7);
      expect(spots[0].x).toBeCloseTo(spots[0].trueX, 10);
      expect(spots[0].y).toBeCloseTo(spots[0].trueY, 10);
    }
});
it('labels delay-only corpus rugs without inventing a size requester and bounds header rows', () => {
  const rugs = roomRugs(delay, current(delay));
  expect(roomCaptions(rugs)).toEqual([
    'room 1 · size not specified',
    'room 2 · size not specified',
  ]);
  const crowded = roomCaptions([...rugs, { ...rugs[0], orbit: 3 }]);
  expect(crowded).toHaveLength(2);
  expect(crowded[1]).toContain('+1 more rug');
});
it('omits out-of-section rests but preserves an out-of-section scored hold', () => {
  const f = scoreFrame(3);
  f.instruments[0].inSection = false;
  f.instruments[1].inSection = false;
  f.notes = [note(10, 11, {}, '0'), note(9, 10, {}, '1')];
  expect(current(f).map((m) => m.instruments[0].id)).toEqual(['0', '2']);
  expect(current(f)[0].held).toBe(true);
});
