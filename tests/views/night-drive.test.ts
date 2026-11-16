import { expect, test } from 'vitest';
import {
  hillDriver,
  hillHeight,
  hillProfile,
  hitFlash,
  pitch,
  PLAYHEAD_Z,
  roadMarks,
  roadVoices,
  roadZ,
  ROAD_LENGTH,
  sectionRoad,
} from '../../src/views/night-drive/model';
import { scoreFrame } from './score-fixture';
import type { ViewNote } from '../../src/views/types';

const note = (
  instrument: string,
  start: number,
  value: ViewNote['value'] = {},
  end = start + 0.1,
  hasOnset = true,
): ViewNote => ({ instrument, start, end, value, hasOnset });
test('roles use rhythm and pitch, regardless of misleading instrument names', () => {
  const f = scoreFrame(5);
  f.instruments.forEach((i) => {
    i.name = 'kick';
  });
  f.notes = [
    ...Array.from({ length: 4 }, (_, i) => note('0', i)),
    ...Array.from({ length: 4 }, (_, i) => note('1', i + 0.5)),
    ...Array.from({ length: 32 }, (_, i) => note('2', i / 8)),
    ...Array.from({ length: 4 }, (_, i) => note('3', i, { note: 'c2' })),
    note('4', 0.1),
    note('4', 0.45),
    note('4', 1.8),
  ];
  expect(roadVoices(f).map((v) => v.role)).toEqual(['gates', 'posts', 'lane', 'lights', 'posts']);
  f.instruments.forEach((i) => {
    i.name = 'hats';
  });
  expect(roadVoices(f).map((v) => v.role)).toEqual(['gates', 'posts', 'lane', 'lights', 'posts']);
  const techno = scoreFrame(3);
  techno.notes = [
    ...Array.from({ length: 16 }, (_, i) => note('0', i / 4)),
    ...Array.from({ length: 16 }, (_, i) => note('1', i / 4 + 0.125)),
    ...Array.from({ length: 8 }, (_, i) => note('2', i / 2 + 0.25)),
  ];
  expect(roadVoices(techno).map((v) => v.role)).toEqual(['gates', 'lane', 'posts']);
  f.instruments[0].inSection = false;
  expect(roadVoices(f).find((v) => v.role === 'gates')?.instrument.id).toBe('2');
});
test('pitch precedence and fragments never invent drum hits', () => {
  expect(pitch({ note: 'eb3', n: 12, freq: 440 })).toBe(51);
  expect(pitch({ note: 36, n: 12 })).toBe(36);
  expect(pitch({ n: 52 })).toBe(52);
  expect(pitch({ freq: 440 })).toBe(69);
  expect(pitch({ s: 'bd' })).toBeUndefined();
  const f = scoreFrame();
  f.notes = [note('0', 0, {}, 1, false), note('0', 1, { note: 'c3' }, 2, false)];
  const voice = roadVoices(f)[0];
  expect(voice.role).toBe('lights');
  expect(roadMarks(voice)).toEqual([{ start: 1, end: 2, pitch: 48, onset: false, count: 1 }]);
  expect(hitFlash(f.notes[0], 0.01, 1)).toBe(0);
});
test('hills choose the most variable setting; units do not dominate and values hold for whole notes', () => {
  const f = scoreFrame(2);
  f.notes = [
    note('0', 0, { note: 20, lpf: 2000, gain: 0.2 }, 1),
    note('0', 1, { note: 80, lpf: 2001, gain: 0.2 }, 2),
    note('0', 2, { note: 30, lpf: 2001, gain: 0.2 }, 3),
    note('1', 0, { pan: -1 }, 1),
    note('1', 1, { pan: 1 }, 2),
    note('1', 2, { pan: -1 }, 3),
  ];
  const driver = hillDriver(roadVoices(f));
  expect(driver).toMatchObject({ instrument: '1', setting: 'pan', min: -1, max: 1 });
  expect(hillHeight(driver, 0.1)).toBe(1);
  expect(hillHeight(driver, 0.99)).toBe(1);
  expect(hillHeight(driver, 1)).toBe(7);
  expect(hillHeight(driver, 1.99)).toBe(7);
  expect(hillProfile(driver, 0, 3)).toEqual([
    { time: 0, height: 1 },
    { time: 1, height: 1 },
    { time: 1, height: 7 },
    { time: 2, height: 7 },
    { time: 2, height: 1 },
    { time: 3, height: 1 },
  ]);
  expect(hillProfile(driver, 0, 3)).toEqual(hillProfile(driver, 0, 3));
  expect(hillProfile(driver, 0, 1)).toEqual([
    { time: 0, height: 1 },
    { time: 1, height: 1 },
  ]);
  const irregular = driver && {
    ...driver,
    samples: [
      { start: 0.137, end: 0.763, value: -1 },
      { start: 0.763, end: 1.81, value: 1 },
    ],
  };
  expect(hillHeight(irregular, 0.7629)).toBe(1);
  expect(hillHeight(irregular, 0.763)).toBe(7);
  expect(hillHeight(irregular, 1.7)).toBe(7);
  f.instruments[1].muted = true;
  expect(hillDriver(roadVoices(f))?.setting).toBe('lpf');
  f.notes = [note('0', 0, { gain: 1 }), note('0', 1, { gain: 1 })];
  expect(hillDriver(roadVoices(f))).toBeUndefined();
  expect(hillProfile(undefined, 0, 4)).toEqual([
    { time: 0, height: 2 },
    { time: 4, height: 2 },
  ]);
});
test('road and hit positions are absolute through jumps, reverse time and tempo changes', () => {
  const hit = note('0', 10);
  for (const now of [9, 10.05, 12, 10, 9.5, 10]) {
    expect(roadZ(hit.start, now, 4)).toBeCloseTo(-1 - ((10 - now) * ROAD_LENGTH) / 4);
    expect(hitFlash(hit, now, 0.5)).toBeCloseTo(
      now === 10 ? 1 : now === 10.05 ? 1 - 0.05 / 0.075 : 0,
    );
  }
  expect(roadZ(10, 10, 4)).toBe(PLAYHEAD_Z);
  expect(roadZ(11, 10, 4)).toBeLessThan(PLAYHEAD_Z);
  expect(roadZ(10, 10.1, 4)).toBeGreaterThan(PLAYHEAD_Z);
  expect(roadZ(11, 10.05, 4) - roadZ(11, 10, 4)).toBeCloseTo(
    (roadZ(11, 10.1, 4) - roadZ(11, 10, 4)) / 2,
  );
  expect(hitFlash(hit, 10.05, 1)).toBeGreaterThan(hitFlash(hit, 10.05, 0.5));
});
test('one and twenty instruments, resting voices, empty road and 500 notes retain all occupancy', () => {
  for (const count of [1, 20]) {
    const f = scoreFrame(count);
    f.notes = f.instruments.map((i) => note(i.id, 10, { note: 48 + i.index }));
    expect(roadVoices(f)).toHaveLength(count);
    expect(roadVoices(f).flatMap((voice) => roadMarks(voice))).toHaveLength(count);
    f.instruments[0].inSection = false;
    expect(roadVoices(f)).toHaveLength(count - 1);
  }
  const f = scoreFrame();
  expect(roadVoices(f).flatMap((voice) => roadMarks(voice))).toEqual([]);
  f.notes = Array.from({ length: 500 }, (_, i) =>
    note('0', 10 + i / 500, {}, 10 + i / 500 + 0.0001),
  );
  const voice = roadVoices(f)[0],
    marks = roadMarks(voice);
  expect(voice.dense).toBe(true);
  expect(marks.length).toBeLessThanOrEqual(128);
  for (const n of f.notes)
    expect(
      marks.some((m) => m.start <= n.start && m.end > n.start) &&
        marks.some((m) => m.start < n.end && m.end >= n.end),
    ).toBe(true);
  expect(marks.reduce((sum, m) => sum + m.count, 0)).toBeGreaterThanOrEqual(500);
  const sustained = { ...voice, notes: [note('0', 0, {}, 1e9), ...f.notes] };
  const bounded = roadMarks(sustained, 10, 11);
  expect(bounded).toHaveLength(128);
  expect(bounded.every((mark) => mark.start >= 10 && mark.end <= 11)).toBe(true);
});
test('section progress and upcoming road bands wrap and scrub without state', () => {
  const sections = [
    { name: 'intro', from: 0, to: 8 },
    { name: 'drop', from: 8, to: 16 },
  ];
  expect(sectionRoad({ sections, now: 7, lookAhead: 4 })).toMatchObject({
    progress: 7 / 8,
    ahead: [{ name: 'drop', time: 8 }],
  });
  expect(sectionRoad({ sections, now: 15, lookAhead: 4 }).ahead).toEqual([
    { name: 'intro', time: 16 },
  ]);
  expect(sectionRoad({ sections, now: 23, lookAhead: 4 }).ahead).toEqual([
    { name: 'drop', time: 24 },
  ]);
  expect(sectionRoad({ sections, now: 7, lookAhead: 4 }).progress).toBe(7 / 8);
  expect(sectionRoad({ sections: [], now: 10.5, lookAhead: 4 })).toEqual({
    current: undefined,
    progress: 0.5,
    ahead: [],
  });
});
