import { expect, it } from 'vitest';
import { constellationLayout } from '../src/live/constellation';
import { liveModel, type LiveModel } from '../src/live/model';
import { instruments } from '../src/document';
import { importStrudel } from '../src/import';

const model = (count: number, rooms: number): LiveModel => ({
  cycle: null,
  instruments: Array.from({ length: count }, (_, n) => ({
    id: String(n),
    name: `Instrument ${n}`,
    nameSource: 'author',
    colour: n,
    lastOnset: null,
    nextOnset: null,
    inSection: true,
    silenced: false,
    sound: 'ready',
    error: null,
    room: n % (rooms + 1) || null,
    noteStarts: n,
  })),
  rooms: Array.from({ length: rooms }, (_, n) => ({
    orbit: n + 1,
    members: Array.from({ length: count }, (_, j) => j)
      .filter((j) => j % (rooms + 1) === n + 1)
      .map(String),
    reverb: 0.4,
    delay: 0.25,
    conflict: false,
  })),
});
for (const count of [1, 6, 30])
  for (const rooms of [0, 1, 3])
    for (const box of [
      { width: 240, height: 240 },
      { width: 358, height: 300 },
    ])
      it(`${count} instruments, ${rooms} rooms in ${box.width}×${box.height} fit deterministically`, () => {
        const m = model(count, rooms),
          layout = constellationLayout(m, box);
        expect(layout).toEqual(constellationLayout(m, box));
        for (const p of layout.planets) {
          expect(p.x - p.r).toBeGreaterThanOrEqual(0);
          expect(p.x + p.r).toBeLessThanOrEqual(box.width);
          expect(p.y - p.r).toBeGreaterThanOrEqual(0);
          expect(p.y + p.r).toBeLessThanOrEqual(box.height);
          for (const q of layout.planets)
            if (p !== q) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(p.r + q.r);
          for (const region of layout.regions) {
            const member = m.rooms.find((r) => r.orbit === region.orbit)!.members.includes(p.id);
            if (member) {
              expect(p.x - p.r).toBeGreaterThanOrEqual(region.x);
              expect(p.x + p.r).toBeLessThanOrEqual(region.x + region.width);
              expect(p.y - p.r).toBeGreaterThanOrEqual(region.y);
              expect(p.y + p.r).toBeLessThanOrEqual(region.y + region.height);
            } else
              expect(
                p.x > region.x &&
                  p.x < region.x + region.width &&
                  p.y > region.y &&
                  p.y < region.y + region.height,
              ).toBe(false);
          }
        }
        const later = constellationLayout(
          {
            ...m,
            cycle: 9,
            instruments: m.instruments.map((i) => ({
              ...i,
              lastOnset: 9,
              inSection: false,
              noteStarts: 100,
            })),
          },
          box,
        );
        expect(later.planets.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
          layout.planets.map(({ id, x, y }) => ({ id, x, y })),
        );
      });
it('radius reflects starts and is clamped; empty input stays empty', () => {
  const m = model(6, 0),
    { planets } = constellationLayout(m, { width: 358, height: 300 });
  expect(planets[0].r).toBeLessThan(planets[5].r);
  expect(planets.every((p) => p.r >= 4 && p.r <= 11)).toBe(true);
  expect(constellationLayout(model(0, 0), { width: 240, height: 240 }).planets).toEqual([]);
});
it('counts real starts in the section, excludes fragments, and distinguishes unasked from quiet', () => {
  const rows = instruments(importStrudel('s("bd")').doc);
  const input = {
    rows,
    sections: [],
    events: {},
    sounds: [],
    solo: null,
    playhead: null,
    fromCycle: 1,
    toCycle: 3,
  };
  expect(liveModel(input).instruments[0].noteStarts).toBeNull();
  const events = {
    [rows[0].id]: {
      cps: 1,
      error: null,
      opaqueValues: false,
      events: [
        {
          whole: [1, 2] as [number, number],
          part: [1, 2] as [number, number],
          value: {},
          hasOnset: true,
        },
        {
          whole: [0, 2] as [number, number],
          part: [1, 2] as [number, number],
          value: {},
          hasOnset: false,
        },
      ],
    },
  };
  expect(liveModel({ ...input, events }).instruments[0].noteStarts).toBe(1);
  expect(liveModel({ ...input, events, fromCycle: 3, toCycle: 4 }).instruments[0].noteStarts).toBe(
    0,
  );
});
