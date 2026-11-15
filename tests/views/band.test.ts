import { expect, test } from 'vitest';
import { analyse, bubbles, pitch, poses } from '../../src/views/band/model';
import type { ViewFrame, ViewNote } from '../../src/views/types';

const note = (
  start: number,
  end: number,
  value: ViewNote['value'] = {},
  hasOnset = true,
): ViewNote => ({ instrument: 'a', start, end, value, hasOnset });
const frame = (notes: ViewNote[], count = 1, now = 0.01): ViewFrame => ({
  now,
  playing: true,
  cps: 0.5,
  notes,
  from: 0,
  to: 16,
  lookAhead: 4,
  trails: 1,
  width: 1300,
  height: 760,
  dpr: 1,
  rooms: [],
  sections: [],
  instruments: Array.from({ length: count }, (_, index) => ({
    id: index ? `i${index}` : 'a',
    name: 'a misleading name',
    index,
    colour: '#ff0000',
    sounding: true,
    inSection: true,
    muted: false,
  })),
  theme: {
    name: 'test',
    ground: '#000000',
    panel: '#111111',
    line: '#222222',
    text: '#ffffff',
    muted: '#aaaaaa',
    accent: '#ffff00',
    fontDisplay: 'sans-serif',
    fontMono: 'monospace',
    radius: 10,
    glow: true,
  },
});
test('roles come from density, duration, pitch and evidenced within-note movement', () => {
  const role = (notes: ViewNote[]) => analyse(notes).get('a')!.body;
  expect(role([note(0, 0.125), note(0.5, 0.625)])).toBe('heavy');
  expect(role(Array.from({ length: 8 }, (_, i) => note(i / 8, (i + 1) / 8)))).toBe('twitchy');
  expect(role([note(0, 1, { note: 'c1' })])).toBe('low');
  expect(
    role([note(0, 1, { note: 'c2', lpf: 400 }), note(0, 1, { note: 'c2', lpf: 800 }, false)]),
  ).toBe('jelly');
  expect(role([note(0, 1, { note: 'c3', lpf: '[function:unchecked]' })])).toBe('melody');
  expect(role([note(0, 0.5)])).toBe('plain');
  expect(pitch({ note: 'eb4' })).toBe(63);
  expect(pitch({ n: 60 })).toBe(60);
  expect(pitch({ freq: 440 })).toBe(69);
});
test('weighted squash, hop and pitch stretch reverse exactly with the playhead', () => {
  const notes = [note(0, 0.25)];
  const f = frame(notes);
  const parts = analyse(notes);
  const original = poses(f, parts);
  const compressed = poses({ ...f, now: 0.022 }, parts)[0];
  const recovered = poses({ ...f, now: 0.07 }, parts)[0];
  expect(compressed.height).toBeLessThan(recovered.height * 0.8);
  expect(compressed.width * compressed.height).toBeCloseTo(recovered.width * recovered.height);
  poses({ ...f, now: 10 }, parts);
  expect(poses(f, parts)).toEqual(original);
  const hats = Array.from({ length: 8 }, (_, i) => note(i / 8, (i + 1) / 8));
  expect(poses(frame(hats, 1, 0.0625), analyse(hats))[0].hop).toBeGreaterThan(20);
  const melody = [note(0, 1, { note: 60 }), note(1, 2, { note: 84 })];
  const melodic = analyse(melody);
  expect(poses(frame(melody, 1, 1.5), melodic)[0].height).toBeGreaterThan(
    poses(frame(melody, 1, 0.5), melodic)[0].height,
  );
});
test('fragments hold a mouth without inventing an onset; mute and zero gain stay quiet', () => {
  const notes = [note(0, 1, {}, false)];
  const f = frame(notes);
  const p = poses(f, analyse(notes))[0];
  expect(p.mouth).toBe(1);
  expect(p.hop).toBe(0);
  f.instruments[0].muted = true;
  expect(poses(f, analyse(notes))[0].active).toBe(0);
  expect(
    poses(frame([note(0, 1, { gain: 0 })]), analyse([note(0, 1, { gain: 0 })]))[0].active,
  ).toBe(0);
});
test('one, twenty, empty and 500 events per cycle retain all occupancy', () => {
  expect(poses(frame([]), analyse([]))).toHaveLength(1);
  const twenty = poses(frame([], 20), analyse([]));
  expect(new Set(twenty.map((p) => p.floor)).size).toBe(2);
  for (const p of twenty) {
    expect(p.x - p.width / 2).toBeGreaterThan(0);
    expect(p.x + p.width / 2).toBeLessThan(1300);
  }
  const dense = Array.from({ length: 500 }, () => note(0, 1));
  expect(poses(frame(dense), analyse(dense))[0].occupancy).toBe(500);
});
test('section changes walk between stable onstage and backstage positions reversibly', () => {
  const notes = [note(0, 1)];
  const f = {
    ...frame(notes),
    instruments: frame(notes).instruments.map((i) => ({ ...i, inSection: false })),
    sections: [
      { name: 'a', from: 0, to: 1 },
      { name: 'b', from: 1, to: 2 },
    ],
  };
  const parts = analyse(notes),
    start = poses({ ...f, now: 1 }, parts)[0],
    end = poses({ ...f, now: 1.3 }, parts)[0],
    middle = poses({ ...f, now: 1.15 }, parts)[0];
  expect(start.floor).toBeCloseTo(760 * 0.72);
  expect(end.floor).toBeCloseTo(760 * 0.925);
  expect(middle.floor).toBeGreaterThan(start.floor);
  expect(middle.floor).toBeLessThan(end.floor);
  expect(poses({ ...f, now: 1.15 }, parts)[0]).toEqual(middle);
});
test('crowded bubbles never overlap and loudest wins', () => {
  const p = poses(frame([note(0, 1)]), analyse([note(0, 1)]))[0];
  const placed = bubbles(
    [
      { ...p, active: 1 },
      { ...p, active: 2 },
    ],
    560,
    20,
  );
  expect(placed).toHaveLength(1);
  expect(placed[0].pose.active).toBe(2);
});

test('section membership and entrances also work on later song iterations', () => {
  const notes = [note(2, 3)];
  const f = {
    ...frame(notes),
    from: 2,
    to: 4,
    sections: [
      { name: 'on', from: 0, to: 1 },
      { name: 'off', from: 1, to: 2 },
    ],
  };
  const parts = analyse(notes);
  expect(poses({ ...f, now: 2.4 }, parts)[0].backstage).toBe(false);
  expect(
    poses(
      { ...f, now: 3.4, instruments: f.instruments.map((i) => ({ ...i, inSection: false })) },
      parts,
    )[0].backstage,
  ).toBe(true);
  const start = poses({ ...f, now: 2 }, parts)[0];
  expect(start.floor).toBeCloseTo(760 * 0.925);
});
