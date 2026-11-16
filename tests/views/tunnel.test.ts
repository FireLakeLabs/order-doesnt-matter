import { expect, test } from 'vitest';
import { tunnelCycles, tunnelPose, nextSection } from '../../src/views/tunnel/model';
import { cycleScore, occupancyArcs } from '../../src/views/shared/cycle-score';
import { scoreFrame } from './score-fixture';

test('successive rings project at .64 with bright future cycles and a quarter-cycle exit', () => {
  const a = tunnelPose(10, 10.4, 6),
    b = tunnelPose(11, 10.4, 6);
  expect(a.depth / b.depth).toBeCloseTo(0.64);
  expect(b.brightness).toBeGreaterThanOrEqual(0.8);
  expect(tunnelPose(16, 10.4, 6).brightness).toBeGreaterThanOrEqual(0.4);
  expect(tunnelPose(9, 10, 6).brightness).toBe(1);
  expect(tunnelPose(9, 10.125, 6).brightness).toBe(0.5);
  expect(tunnelPose(9, 10.25, 6).brightness).toBe(0);
  expect(tunnelCycles(10.4, 6)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
  expect(tunnelCycles(0, 1)).toEqual([0, 1]);
});
test('forward travel, slow travel and reverse scrubbing are continuous and deterministic', () => {
  const before = tunnelPose(11, 10.99999, 6).depth;
  const after = tunnelPose(11, 11.00001, 6).depth;
  expect(Math.abs(before - after)).toBeLessThan(0.0001);
  expect(tunnelPose(11, 10.5, 6).depth).toBeLessThan(tunnelPose(11, 10.4, 6).depth);
  expect(tunnelPose(11, 10.425, 6).depth).toBeGreaterThan(tunnelPose(11, 10.5, 6).depth);
  expect(tunnelPose(11, 10.4, 6)).toEqual(tunnelPose(11, 10.4, 6));
});
test('future section membership comes from its own score, including 1 and 20 instruments', () => {
  for (const count of [1, 20]) {
    const f = scoreFrame(count);
    f.notes = [
      { instrument: String(count - 1), start: 16.137, end: 16.763, hasOnset: false, value: {} },
    ];
    const bands = cycleScore(f, 16);
    expect(bands).toHaveLength(count);
    expect(bands.filter((b) => !b.resting).map((b) => b.id)).toEqual([String(count - 1)]);
    expect(bands.find((b) => !b.resting)?.arcs[0]).toMatchObject({
      from: expect.closeTo(0.137),
      to: expect.closeTo(0.763),
      onset: false,
    });
    expect(cycleScore(f, 10).every((b) => b.resting)).toBe(true);
    expect(cycleScore(f, 16)).toEqual(bands);
  }
  expect(cycleScore(scoreFrame(0), 0)).toEqual([]);
});
test('500 notes preserve occupied area rather than dropping tiny notes', () => {
  const f = scoreFrame();
  f.notes = Array.from({ length: 500 }, (_, i) => ({
    instrument: '0',
    start: 10 + i / 500,
    end: 10 + i / 500 + 0.0001,
    hasOnset: true,
    value: {},
  }));
  const arcs = cycleScore(f, 10)[0].arcs;
  const occupied = occupancyArcs(arcs);
  expect(arcs).toHaveLength(500);
  expect(occupied.reduce((area, arc) => area + (arc.to - arc.from) * arc.coverage, 0)).toBeCloseTo(
    0.05,
    5,
  );
});
test('section countdown names the breakdown six cycles ahead and wraps arrangements', () => {
  const sections = [
    { name: 'intro', from: 0, to: 8 },
    { name: 'drop', from: 8, to: 16 },
    { name: 'breakdown', from: 16, to: 28 },
  ];
  expect(nextSection({ sections, now: 10.4 })).toEqual({ name: 'breakdown', cycles: 6 });
  expect(nextSection({ sections, now: 27.5 })).toEqual({ name: 'intro', cycles: 1 });
  expect(nextSection({ sections, now: 38.4 })).toEqual({ name: 'breakdown', cycles: 6 });
  expect(nextSection({ sections: [], now: 10 })).toBeUndefined();
});
