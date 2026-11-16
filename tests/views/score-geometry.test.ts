import { expect, test } from 'vitest';
import { scoreGeometry, lightRange } from '../../src/views/shared/score-geometry';
import type { ScoreStrip } from '../../src/views/shared/score-geometry';
const strip: ScoreStrip = {
  cycle: 10,
  radius: 1,
  width: 0.1,
  colour: '#fff',
  muted: false,
  arcs: [{ from: 0.137, to: 0.763, start: 0.137, end: 0.763, onset: true }],
};
test('indexed ribbons retain exact endpoints with fewer vertices', () => {
  const data = scoreGeometry([strip], () => [1, 1, 1]);
  expect(data.positions[0]).toBeCloseTo(10.137, 5);
  expect(data.positions.at(-3)).toBeCloseTo(10.763, 5);
  expect(data.positions.length / 3).toBe(2 * (Math.ceil(0.626 * 128) + 1));
  expect(data.indices.length).toBe(6 * Math.ceil(0.626 * 128));
  expect(Math.max(...data.indices)).toBe(data.positions.length / 3 - 1);
});
test('emission range keeps held notes, onset flashes and fragments, but skips unrelated cycles and tracks', () => {
  const data = scoreGeometry(
    [
      { ...strip, cycle: 0, track: true },
      { ...strip, cycle: 0 },
      { ...strip, cycle: 10, arcs: [{ from: 0, to: 1, start: -2, end: 2, onset: false }] },
      { ...strip, cycle: 20 },
    ],
    () => [1, 1, 1],
  );
  expect(data.lights).toHaveLength(3);
  const middle = data.lights[1];
  expect(lightRange(data.lights, 10.4, 0.1)).toEqual({ start: middle.first, count: middle.count });
  const onset = data.lights[0];
  expect(lightRange(data.lights, 0.8, 1)).toEqual({ start: onset.first, count: onset.count });
  expect(lightRange(data.lights, 15, 0.1)).toEqual({ start: 0, count: 0 });
  const simultaneous = scoreGeometry(
    [strip, { ...strip, arcs: [{ from: 0, to: 1, start: 0, end: 1, onset: false }] }],
    () => [1, 1, 1],
  );
  expect(lightRange(simultaneous.lights, 10.4, 0.1)).toEqual({
    start: 0,
    count: simultaneous.indices.length,
  });
});

test('every coarser index buffer retains both real endpoints and emission spans', () => {
  const data = scoreGeometry([strip], () => [1, 1, 1]);
  for (const lod of data.lods) {
    expect(Math.min(...lod.indices)).toBe(0);
    expect(Math.max(...lod.indices)).toBe(data.positions.length / 3 - 1);
    expect(lod.lights[0]).toMatchObject({
      start: 10.137,
      end: 10.763,
      onset: true,
      first: 0,
      count: lod.indices.length,
    });
  }
  expect(data.lods[2].indices.length).toBeLessThan(data.lods[0].indices.length / 2);
});

test('optional helix geometry bakes unit angles independently of layout', () => {
  const data = scoreGeometry([strip], () => [1, 1, 1], true);
  const resized = scoreGeometry([{ ...strip, radius: 0.5, width: 0.2 }], () => [0, 0, 1], true);
  expect(data.curves).toEqual(resized.curves);
  expect(data.curves[0]).toBeCloseTo(Math.sin(10.137 * Math.PI * 2), 5);
  expect(data.curves[1]).toBeCloseTo(Math.cos(10.137 * Math.PI * 2), 5);
  expect(data.curves.length).toBe((data.positions.length / 3) * 2);
  expect(data.styles).toEqual([{ first: 0, count: data.positions.length / 3 }]);
});
