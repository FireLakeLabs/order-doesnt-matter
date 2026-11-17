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
    settings: [],
    rewrites: [],
    room: null,
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
  const hopping = poses(frame(hats, 1, 0.0625), analyse(hats))[0];
  expect(hopping.hop / hopping.height).toBeCloseTo(0.3);
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

test('four hits per cycle stay heavy beside eight twitchy hits', () => {
  const notes = [
    ...Array.from({ length: 4 }, (_, i) => note(i / 4, (i + 1) / 4)),
    ...Array.from({ length: 8 }, (_, i) => ({ ...note(i / 8, (i + 1) / 8), instrument: 'b' })),
  ];
  const parts = analyse(notes);
  expect(parts.get('a')!.body).toBe('heavy');
  expect(parts.get('b')!.body).toBe('twitchy');
});
test('layered onsets and different pitches cannot fabricate moving-setting evidence', () => {
  expect(
    analyse([note(0, 1, { note: 60, pan: 0 }), note(0, 1, { note: 60, pan: 1 })]).get('a')!.body,
  ).toBe('melody');
  expect(
    analyse([note(0, 1, { note: 24, gain: 0.5 }), note(0, 1, { note: 24, gain: 1 })]).get('a')!
      .body,
  ).toBe('low');
  expect(
    analyse([note(0, 1, { note: 60, lpf: 400 }), note(0, 1, { note: 64, lpf: 800 }, false)]).get(
      'a',
    )!.body,
  ).toBe('melody');
});
test('ripple rate belongs to a held span and does not grow with song length', () => {
  const held = (start: number, length = 1) => [
    note(start, start + length, { note: 60, lpf: 400 }),
    note(start, start + length, { note: 60, lpf: 800 }, false),
    note(start, start + length, { note: 60, lpf: 400 }, false),
    note(start, start + length, { note: 60, lpf: 800 }, false),
  ];
  const single = analyse(held(0)).get('a')!;
  const song = analyse(Array.from({ length: 32 }, (_, i) => held(i)).flat()).get('a')!;
  expect(single.body).toBe('jelly');
  expect(single.ripple).toBe(3);
  expect(song.ripple).toBe(single.ripple);
  expect(analyse(held(0, 2)).get('a')!.ripple).toBe(1.5);
});
test('old held spans do not invent previous-section participation at an entrance', () => {
  const notes = [note(0, 3)];
  const f = {
    ...frame(notes, 1, 2),
    sections: [
      { name: 'first', from: 0, to: 1 },
      { name: 'rest', from: 1, to: 2 },
      { name: 'return', from: 2, to: 3 },
    ],
  };
  expect(poses(f, analyse(notes))[0].floor).toBeCloseTo(760 * 0.925);
});

// Band uses the same reader as other views, including trimmed note names.
test('Band shares named pitch normalization and frequency fallback', () => {
  expect(pitch({ note: ' eb1 ' })).toBe(27);
  expect(pitch({ note: ' invalid ', freq: '440' })).toBe(69);
});
