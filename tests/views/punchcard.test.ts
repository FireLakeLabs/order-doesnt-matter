import { expect, it } from 'vitest';
import { layout } from '../../src/views/punchcard/model';
import { flash, indexScore } from '../../src/views/shared/retro-2d';
import { scoreFrame } from './score-fixture';
it('keeps every instrument row within the card with one or twenty instruments', () => {
  for (const count of [0, 1, 20]) {
    const f = scoreFrame(count),
      l = layout(f);
    expect(l.row).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) expect(l.top + (i + 0.5) * l.row).toBeLessThan(l.bottom);
  }
});
it('indexes dense onsets and fragments and suppresses fragment flashes at arbitrary time', () => {
  const f = scoreFrame(20);
  f.notes = Array.from({ length: 500 }, (_, i) => ({
    instrument: String(i % 20),
    start: 10 + i / 500,
    end: 11 + i / 500,
    hasOnset: i % 2 === 0,
    value: {},
  }));
  const score = indexScore(f.notes);
  expect([...score.values()].reduce((n, group) => n + group.length, 0)).toBe(500);
  f.now = 10.002;
  expect(flash(f.notes[1], f)).toBe(0);
  f.now = 10;
  expect(flash(f.notes[0], f)).toBe(1);
  f.now = 9;
  expect(flash(f.notes[0], f)).toBe(0);
  f.now = 10;
  expect(flash(f.notes[0], f)).toBe(1);
});
it('scrolls actual spans across a fixed gate and reproduces earlier layouts', () => {
  const f = scoreFrame(),
    before = layout(f);
  f.now += 3;
  expect(layout(f).time.x(11)).toBeLessThan(before.time.x(11));
  f.now -= 3;
  expect(layout(f).time.x(11)).toBeCloseTo(before.time.x(11));
  expect(layout(f).time.gate).toBe(before.time.gate);
});
