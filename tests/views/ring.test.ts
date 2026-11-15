import { expect, test } from 'vitest';
import type { ViewFrame, ViewNote } from '../../src/views/types';
import {
  arcVertices,
  bandLayout,
  ghostBand,
  cycleArcs,
  occupancy,
  ringAngle,
  sectionEase,
  sectionAt,
  trailDuration,
} from '../../src/views/ring/model';

const note = (start: number, end: number, instrument = '0', hasOnset = true): ViewNote => ({
  start,
  end,
  instrument,
  hasOnset,
  value: {},
});
function frame(count = 1): ViewFrame {
  return {
    now: 10.4,
    playing: true,
    cps: 140 / 240,
    notes: [],
    from: 0,
    to: 20,
    instruments: Array.from({ length: count }, (_, index) => ({
      id: String(index),
      index,
      name: String(index),
      colour: '#FF4D8D',
      sounding: false,
      inSection: true,
      muted: false,
    })),
    sections: [],
    rooms: [],
    lookAhead: 4,
    trails: 1,
    width: 1300,
    height: 760,
    dpr: 1,
    theme: {
      name: 'arcade',
      ground: '#07060D',
      panel: '#12101F',
      line: '#2A2545',
      text: '#F4F1FF',
      muted: '#A49EC4',
      accent: '#FFD23F',
      fontDisplay: 'Space Grotesk',
      fontMono: 'JetBrains Mono',
      radius: 10,
      glow: true,
    },
  };
}
test('real spans clip at a cycle seam and fragments remain non-hits', () => {
  const arcs = cycleArcs([note(9.75, 10.25), note(10.37, 10.63, '0', false), note(11, 12)], 10);
  expect([...arcs].sort((a, b) => a.from - b.from)).toEqual([
    { from: 0, to: 0.25, start: -0.25, end: 0.25, onset: true },
    {
      from: 0.3699999999999992,
      to: 0.6300000000000008,
      start: 0.3699999999999992,
      end: 0.6300000000000008,
      onset: false,
    },
  ]);
  const geometry = arcVertices(arcs);
  expect(geometry.positions.length).toBe(geometry.timing.length);
  expect(Math.max(...geometry.timing.filter((_, index) => index % 3 === 2))).toBe(1);
  expect(
    [...arcVertices(arcs.filter((arc) => !arc.onset)).timing]
      .filter((_, index) => index % 3 === 2)
      .every((v) => v === 0),
  ).toBe(true);
});
test('upcoming arcs approach from clockwise and the same time always has the same pose', () => {
  const initial = ringAngle(10.5, 10.4);
  expect(initial).toBeGreaterThan(0);
  expect(ringAngle(10.5, 10.6)).toBeLessThan(0);
  expect(ringAngle(10.5, 10.4)).toBe(initial);
  expect(ringAngle(10.5, 10.5)).toBe(0);
});
test('1 and 20 playing bands fit the required radial extent and minimum width', () => {
  for (const count of [1, 20]) {
    const bands = bandLayout(frame(count));
    expect(bands).toHaveLength(count);
    expect(bands[0].radius - bands[0].width / 2).toBeCloseTo(0.28);
    expect(bands[count - 1].radius + bands[count - 1].width / 2).toBeCloseTo(0.92);
    for (const band of bands) expect(band.width * 760 * 0.42).toBeGreaterThanOrEqual(10 - 1e-10);
  }
  expect(bandLayout({ ...frame(0), notes: [] })).toEqual([]);
});
test('held notes earn width by duration; resting instruments are hairlines outside', () => {
  const f = frame(3);
  f.notes = [note(10, 10.03), note(10, 11, '1')];
  f.instruments[2].inSection = false;
  const bands = bandLayout(f);
  expect(bands[1].width).toBeGreaterThan(bands[0].width);
  expect(bands[2].resting).toBe(true);
  expect(bands[2].radius).toBeGreaterThan(0.94);
  expect(bands[2].width * 760 * 0.42).toBeCloseTo(0.8);
});
test('section re-form and trails follow requested musical time', () => {
  const f = frame(2);
  f.sections = [{ name: 'Drop', from: 10, to: 20 }];
  f.notes = [note(9, 10), note(10, 11, '1')];
  expect(sectionEase({ ...f, now: 10 })).toBe(0);
  const midway = sectionEase({ ...f, now: 10.25 });
  expect(midway).toBe(0.5);
  expect(sectionEase({ ...f, now: 15 })).toBe(1);
  expect(bandLayout(f, true).find((b) => b.id === '1')?.resting).toBe(true);
  expect(trailDuration(0)).toBe(0);
  expect(trailDuration(1)).toBe(0.25);
  expect(trailDuration(2)).toBe(1);
});
test('500 tiny notes become area occupancy without dropping sub-texel spans', () => {
  const arcs = cycleArcs(
    Array.from({ length: 500 }, (_, i) => note(10 + i / 500, 10 + i / 500 + 0.0001)),
    10,
  );
  const texture = occupancy(arcs);
  const coverage = texture.filter((_, index) => index % 4 === 0);
  expect([...coverage].reduce((a, b) => a + b, 0) / 2048).toBeCloseTo(0.05, 5);
  expect(coverage.some((v) => v > 0)).toBe(true);
  expect(occupancy([]).every((v) => v === 0)).toBe(true);
});
test('dense fragments cannot erase an actual onset, regardless of input order', () => {
  const arcs = cycleArcs([note(10, 11), note(10.1, 11, '0', false)], 10);
  const a = occupancy(arcs, 8),
    b = occupancy([...arcs].reverse(), 8);
  expect(a).toEqual(b);
  for (let bin = 0; bin < 8; bin++) expect(a[bin * 4 + 3]).toBe(1);
});

test('the lazy renderer contributes its complete MIT notice to the distribution', async () => {
  const { generateLicenses } = await import('../../scripts/licenses');
  const path = await import('node:path');
  const notice = generateLicenses([path.resolve('node_modules/three/build/three.module.js')]);
  expect(notice).toContain('three@0.187.0 — MIT');
  expect(notice).toContain('Copyright © 2010-2026 three.js authors');
  expect(notice).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
});

test('a continuation cannot paint over the onset flash on the same span', () => {
  const arcs = cycleArcs([note(10, 11), note(10, 11, '0', false)], 10);
  expect(arcs).toHaveLength(2);
  expect(arcs.at(-1)?.onset).toBe(true);
});

test('section labels and transitions follow the absolute turn after an arrangement repeats', () => {
  const f = frame();
  f.sections = [
    { name: 'Intro', from: 0, to: 8 },
    { name: 'Drop', from: 8, to: 16 },
  ];
  expect(sectionAt({ ...f, now: 24.25 })).toEqual({ name: 'Drop', from: 24, to: 32 });
  expect(sectionEase({ ...f, now: 24.25 })).toBe(sectionEase({ ...f, now: 8.25 }));
  expect(sectionEase({ ...f, now: 0 })).toBe(1);
});

test('band edges remain stable across alternation, with and without sections and backwards seeks', () => {
  const f = frame(2);
  f.from = 10;
  f.to = 12;
  f.notes = [note(10, 11), note(11, 11.02), note(10, 10.25, '1'), note(11, 11.25, '1')];
  for (const sections of [[], [{ name: 'Drop', from: 10, to: 12 }]]) {
    f.sections = sections;
    const first = bandLayout({ ...f, now: 10.75 });
    expect(bandLayout({ ...f, now: 11.25 })).toEqual(first);
    expect(bandLayout({ ...f, now: 10.75 })).toEqual(first);
  }
});

test('bounded typed geometry retains real arc endpoints', () => {
  const arcs = [{ from: 0.137, to: 0.763, start: 0.137, end: 0.763, onset: true }];
  const data = arcVertices(arcs);
  const angles = data.positions.filter((_, index) => index % 3 === 0);
  expect(data.positions).toBeInstanceOf(Float32Array);
  expect(data.positions.length).toBeLessThanOrEqual(128 * 54);
  expect(Math.min(...angles)).toBeCloseTo(arcs[0].from * Math.PI * 2, 5);
  expect(Math.max(...angles)).toBeCloseTo(arcs[0].to * Math.PI * 2, 5);
  expect(data.positions.length).toBe(data.timing.length);
  expect(data.positions.length).toBe(data.surfaces.length);
});

test('upcoming ghosts remain between adjacent bands even with twenty playing instruments', () => {
  for (const count of [1, 6, 20]) {
    const bands = bandLayout(frame(count));
    for (const [index, band] of bands.entries()) {
      const ghost = ghostBand(band, bands, 760 * 0.42);
      expect(ghost.radius - ghost.width / 2).toBeGreaterThanOrEqual(band.radius + band.width / 2);
      if (bands[index + 1])
        expect(ghost.radius + ghost.width / 2).toBeLessThanOrEqual(
          bands[index + 1].radius - bands[index + 1].width / 2,
        );
    }
  }
});
