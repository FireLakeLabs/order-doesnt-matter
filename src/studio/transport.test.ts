import { expect, test } from 'vitest';
import { actualCps, markedLoop, pageRange, pointerCycle, speeds, wrapCycle } from './transport';
import { checkLoop, checkSpeed } from '../engine/transport';

test('pointer mapping covers the complete song, clamps outside and handles a zero width', () => {
  expect(pointerCycle(100, 100, 1920, 0, 28)).toBe(0);
  expect(pointerCycle(2020, 100, 1920, 0, 28)).toBe(28);
  expect(pointerCycle(1060, 100, 1920, 0, 28)).toBe(14);
  expect(pointerCycle(-10, 0, 100, 4, 20)).toBe(4);
  expect(pointerCycle(500, 0, 100, 4, 20)).toBe(20);
  expect(pointerCycle(5, 0, 0, 4, 20)).toBe(4);
});
test('whole-cycle loop marks work in both drag directions and wrap half-open boundaries', () => {
  expect(markedLoop(10, 8)).toEqual({ from: 8, to: 10 });
  expect(markedLoop(7.9999, 10.0001)).toEqual({ from: 8, to: 10 });
  expect(markedLoop(8.2, 8.2)).toEqual({ from: 8, to: 9 });
  const loop = { from: 8, to: 10 };
  for (const [cycle, wanted] of [
    [8, 8],
    [9.99, 9.99],
    [10, 8],
    [14, 8],
    [7.5, 9.5],
  ])
    expect(wrapCycle(cycle, loop)).toBeCloseTo(wanted);
  expect(wrapCycle(100, null)).toBe(100);
  expect(() => {
    checkLoop({ from: 8.2, to: 9 });
  }).toThrow('whole cycles');
  expect(() => {
    checkLoop({ from: 8, to: 8 });
  }).toThrow('whole cycles');
});
test('speed scales actual tempo and endless pages follow arbitrary positions', () => {
  expect(speeds.map((factor) => actualCps(140 / 240, factor) * 240)).toEqual([35, 70, 105, 140]);
  expect(() => {
    checkSpeed(2);
  }).toThrow();
  expect(pageRange(0)).toEqual({ from: 0, to: 16 });
  expect(pageRange(100.5)).toEqual({ from: 96, to: 112 });
});
