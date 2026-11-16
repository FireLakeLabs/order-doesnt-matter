import { expect, it } from 'vitest';
import {
  analyse,
  cameraKick,
  characterHeight,
  coinCount,
  groundHeight,
  impact,
  sectionIndex,
} from '../../src/views/runner/model';
import { pitch } from '../../src/views/shared/retro-2d';
import type { ViewNote } from '../../src/views/types';
import { scoreFrame } from './score-fixture';
const note = (
  instrument: string,
  start: number,
  value: ViewNote['value'] = {},
  duration = 0.1,
  hasOnset = true,
): ViewNote => ({ instrument, start, end: start + duration, hasOnset, value });
const level = () => [
  ...Array.from({ length: 8 }, (_, i) => note('a', i)),
  ...Array.from({ length: 8 }, (_, i) => note('b', i + 0.5)),
  ...Array.from({ length: 64 }, (_, i) => note('c', i / 8, {}, 0.025)),
  note('d', 0, { note: 'c1' }, 1),
  note('d', 1, { note: 'g1' }, 1),
  note('e', 0, { freq: 440 }, 8),
];
it('chooses the lowest pitch, sparse regular blocks, backbeat crates and dense short coins from notes', () => {
  const parts = analyse(level());
  expect([...parts.values()].map((p) => [p.id, p.role])).toEqual([
    ['a', 'block'],
    ['b', 'crate'],
    ['c', 'coin'],
    ['d', 'ground'],
    ['e', 'platform'],
  ]);
  expect([...analyse(level().reverse()).values()].find((p) => p.role === 'block')?.id).toBe('a');
  // A sustained unpitched atmosphere must not displace a percussive block.
  expect(analyse([...level(), note('atmos', 0, {}, 4)]).get('a')?.role).toBe('block');
  expect(pitch({ note: 42, n: 80, freq: 880 })).toBe(42);
  expect(pitch({ n: 32, freq: 880 })).toBe(32);
  expect(pitch({ freq: 440 })).toBe(69);
  expect(pitch({})).toBeUndefined();
});
it('steps the terrain from the actual pitches at arbitrary times, including backwards', () => {
  const part = analyse(level()).get('d');
  expect(groundHeight(part, 0.9)).toBe(0);
  expect(groundHeight(part, 1)).toBe(7);
  expect(groundHeight(part, 0.9)).toBe(0);
  expect(groundHeight(undefined, 100)).toBe(0);
  expect(groundHeight(part, -1)).toBe(0);
});
it('lands the courier exactly on each block onset and never depends on call order', () => {
  const blocks = analyse([note('a', 1), note('a', 2)]).get('a');
  const height = (now: number, cps = 0.5) => characterHeight(undefined, blocks, now, cps);
  expect(height(1)).toBe(18);
  expect(height(0.9)).toBeGreaterThan(18);
  expect(height(1.2)).toBe(0);
  const before = height(0.95);
  height(10);
  height(-10);
  expect(height(0.95)).toBe(before);
  expect(height(0.85, 1)).toBeGreaterThan(height(0.85, 0.25));
  expect(impact(1, 1, 0.5)).toBe(1);
  expect(impact(1, 0.99, 0.5)).toBe(0);
  expect(impact(1, 1.12, 0.5)).toBe(0);
});
it('counts every supplied coin onset, including exact boundaries and backwards scrubbing', () => {
  const coins = analyse(level()).get('c');
  expect(coinCount(coins, 0, 0)).toBe(1);
  expect(coinCount(coins, 1, 0)).toBe(9);
  expect(coinCount(coins, 5, 0)).toBe(41);
  expect(coinCount(coins, 1, 0)).toBe(9);
  expect(coinCount(coins, 1, 1)).toBe(1);
  expect(coinCount(coins, 0, 1)).toBe(0);
  expect(coinCount(undefined, 1, 0)).toBe(0);
});
it('retains one or twenty instruments and all 500 dense onsets, without treating fragments as hits', () => {
  for (const count of [1, 20]) {
    const notes = Array.from({ length: 500 }, (_, i) =>
      note(String(i % count), i / 500, {}, 0.001),
    );
    const parts = analyse(notes);
    expect(parts.size).toBe(count);
    expect([...parts.values()].reduce((n, p) => n + p.hits.length, 0)).toBe(500);
    for (const p of parts.values()) {
      expect(coinCount(p, 1, 0)).toBe(p.hits.length);
      expect(Number.isFinite(characterHeight(undefined, p, 0.5, 0.5))).toBe(true);
    }
  }
  const fragments = analyse([note('a', 0, {}, 1, false), note('b', 0, { note: 24 }, 2, false)]);
  expect(fragments.get('a')?.hits).toHaveLength(0);
  expect(characterHeight(undefined, fragments.get('a'), 0, 0.5)).toBe(0);
  expect(coinCount(fragments.get('a'), 1, 0)).toBe(0);
  expect(analyse([]).size).toBe(0);
  expect(characterHeight(undefined, undefined, 100, 0)).toBe(0);
  expect(
    sectionIndex(
      {
        sections: [
          { name: 'intro', from: 0, to: 4 },
          { name: 'drop', from: 4, to: 8 },
        ],
      },
      10,
    ),
  ).toBe(0);
});

it('chooses current section roles without letting resting score evidence win', () => {
  const notes = [
    ...level(),
    note('sample', 0, { n: 0 }, 4),
    ...Array.from({ length: 64 }, (_, i) => note('roll', i / 8, {}, 0.025)),
  ];
  const drop = analyse(notes, new Set(['a', 'b', 'c', 'd', 'e']));
  expect(drop.get('d')?.role).toBe('ground');
  expect(drop.get('c')?.role).toBe('coin');
  expect(drop.get('sample')?.role).toBe('platform');
  expect(drop.get('roll')?.role).toBe('crate');
  const sparse = analyse(notes, new Set(['a', 'b']));
  expect(sparse.get('a')?.role).toBe('block');
  expect(sparse.get('b')?.role).toBe('crate');
  const intro = analyse(notes, new Set(['sample', 'roll']));
  expect(intro.get('sample')?.role).toBe('ground');
  expect(intro.get('roll')?.role).toBe('coin');
  expect(analyse(notes, new Set(['a', 'b', 'c', 'd', 'e'])).get('d')?.role).toBe('ground');
});

it('keeps camera kicks on blocks despite dense coins, with a pitched-only fallback and reversible time', () => {
  const frame = scoreFrame(5);
  frame.instruments.forEach((instrument, i) => {
    instrument.id = 'abcde'[i];
  });
  const parts = analyse(level());
  frame.now = 1;
  expect(cameraKick(parts, frame)).toBe(1);
  frame.now = 1.125; // A coin onset, after the block's kick has settled.
  expect(cameraKick(parts, frame)).toBe(0);
  frame.now = 1.5; // Backbeat crate, not another camera kick.
  expect(cameraKick(parts, frame)).toBe(0);
  frame.now = 1;
  expect(cameraKick(parts, frame)).toBe(1);
  const dense = analyse([
    ...level(),
    ...Array.from({ length: 500 }, (_, i) => note('c', i / 500, {}, 0.001)),
  ]);
  frame.now = 0.5;
  expect(cameraKick(dense, frame)).toBe(0);
  const pitched = analyse([note('d', 1, { note: 24 }), note('d', 2, { note: 31 }, 1, false)]);
  frame.now = 1;
  expect(cameraKick(pitched, frame)).toBe(1);
  frame.instruments[3].muted = true;
  expect(cameraKick(pitched, frame)).toBe(0);
  frame.instruments[3].muted = false;
  frame.instruments[3].inSection = false;
  expect(cameraKick(pitched, frame)).toBe(0);
  frame.instruments[3].inSection = true;
  frame.now = 2;
  expect(cameraKick(pitched, frame)).toBe(0); // A fragment never kicks the camera.
  expect(cameraKick(analyse([]), frame)).toBe(0);
});
