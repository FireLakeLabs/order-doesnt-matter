import { expect, it } from 'vitest';
import { rows, trail } from '../../src/views/piano-roll/model';
import { indexScore, timeline } from '../../src/views/shared/retro-2d';
import { scoreFrame } from './score-fixture';
it('keeps pitch above percussion including mixed channels and resting instruments', () => {
  const f = scoreFrame(20);
  f.notes = [
    { instrument: '0', start: 10, end: 11, hasOnset: true, value: { note: 'c2' } },
    { instrument: '0', start: 10.5, end: 11, hasOnset: true, value: {} },
    { instrument: '1', start: 10, end: 11, hasOnset: false, value: { freq: 440 } },
  ];
  const r = rows(f, indexScore(f.notes));
  expect(r.low).toBe(36);
  expect(r.high).toBe(69);
  expect(r.y(69)).toBeLessThan(r.y(36));
  expect(r.unpitched).toContain('0');
  expect(r.unpitched).toContain('19');
  expect(r.drumY('0')).toBeGreaterThan(r.y(36));
  expect(r.drumY('19')).toBeLessThan(r.bottom);
});
it('handles one, twenty, empty and dense scores without losing events', () => {
  for (const count of [1, 20]) {
    const f = scoreFrame(count);
    f.now = 0.4;
    expect(rows(f, indexScore([])).unpitched).toHaveLength(count);
    f.notes = Array.from({ length: 500 }, (_, i) => ({
      instrument: String(i % count),
      start: i / 500,
      end: (i + 1) / 500,
      hasOnset: true,
      value: { n: 40 + (i % 36) },
    }));
    const score = indexScore(f.notes);
    expect([...score.values()].reduce((n, group) => n + group.length, 0)).toBe(500);
    expect(rows(f, score).pitches).toBe(36);
  }
  expect(rows(scoreFrame(0), indexScore([])).pitches).toBe(0);
});
it('shows exactly lookAhead cycles around a fixed playhead at arbitrary time', () => {
  const f = scoreFrame();
  const first = timeline(f, 100, 1200);
  expect(first.to - first.from).toBeCloseTo(f.lookAhead);
  expect(first.x(f.now)).toBeCloseTo(first.gate);
  f.now -= 5;
  expect(timeline(f, 100, 1200).gate).toBe(first.gate);
  f.now += 5;
  expect(timeline(f, 100, 1200).x(11)).toBeCloseTo(first.x(11));
});

it('bounds the keyboard to visible pitches and makes trails reversible and optional', () => {
  const f = scoreFrame();
  const n = { instrument: '0', start: 10, end: 10.5, hasOnset: true, value: { note: 60 } };
  const old = { ...n, start: 0, end: 1, value: { note: 100 } };
  expect(rows(f, indexScore([n, old])).high).toBe(60);
  f.now = 10.6;
  f.trails = 2;
  const before = trail(n, f);
  expect(before).toBeGreaterThan(0);
  f.now = 12;
  expect(trail(n, f)).toBe(0);
  f.now = 10.6;
  expect(trail(n, f)).toBe(before);
  f.trails = 0;
  expect(trail(n, f)).toBe(0);
  f.trails = 2;
  expect(trail({ ...n, hasOnset: false }, f)).toBe(0);
});
