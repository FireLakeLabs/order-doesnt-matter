import { expect, it } from 'vitest';
import { constellationLayout, segmentDistance } from '../src/live/constellation';
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
for (const count of [1, 6, 10, 30])
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
              expect(
                region.circles.some((c) => Math.hypot(c.x - p.x, c.y - p.y) + p.r <= c.r + 0.001),
              ).toBe(true);
            } else {
              expect(region.circles.every((c) => Math.hypot(c.x - p.x, c.y - p.y) > c.r)).toBe(
                true,
              );
              expect(region.links.every((l) => segmentDistance(p, l.from, l.to) > 6)).toBe(true);
            }
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
it('radius reflects starts and box area; empty input stays empty', () => {
  const m = model(6, 0),
    { planets } = constellationLayout(m, { width: 358, height: 300 });
  expect(planets[0].r).toBeLessThan(planets[5].r);
  for (const count of [1, 6, 10]) {
    const box = { width: 300, height: 240 };
    const packed = constellationLayout(model(count, 0), box);
    expect(
      packed.planets.reduce((sum, p) => sum + Math.PI * p.r ** 2, 0) / (box.width * box.height),
    ).toBeGreaterThanOrEqual(0.2);
    if (count <= 8) expect(Math.min(...packed.planets.map((p) => p.r))).toBeGreaterThanOrEqual(14);
  }
  expect(constellationLayout(model(0, 0), { width: 240, height: 240 }).planets).toEqual([]);
});
it('small constellations use substantial area and reserve the halo and room headings', () => {
  const box = { width: 300, height: 240 };
  const measured = [];
  for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 10, 30])
    for (const rooms of [0, 1, 3]) {
      const layout = constellationLayout(model(count, rooms), box);
      const area =
        layout.planets.reduce((sum, p) => sum + Math.PI * p.r ** 2, 0) / (box.width * box.height);
      const min = Math.min(...layout.planets.map((p) => p.r));
      measured.push({
        count,
        rooms,
        area: Number(area.toFixed(3)),
        min: Number(min.toFixed(1)),
        height: Number(layout.height.toFixed(1)),
      });
      if ([1, 6, 10].includes(count))
        expect(area, `${count}/${rooms} occupancy`).toBeGreaterThanOrEqual(0.2);
      if (count <= 8) expect(min).toBeGreaterThanOrEqual(14);
      for (const p of layout.planets) {
        expect(p.x - p.r - 6).toBeGreaterThanOrEqual(0);
        expect(p.x + p.r + 6).toBeLessThanOrEqual(box.width);
        expect(p.y - p.r - 6).toBeGreaterThanOrEqual(0);
        expect(p.y + p.r + 6).toBeLessThanOrEqual(layout.height);
      }
      for (const region of layout.regions)
        for (const p of layout.planets) {
          const l = region.label;
          const dx = p.x - Math.max(l.x, Math.min(l.x + l.width, p.x));
          const dy = p.y - Math.max(l.y, Math.min(l.y + l.height, p.y));
          expect(Math.hypot(dx, dy), `${count}/${rooms}: heading hits ${p.id}`).toBeGreaterThan(
            p.r + 3,
          );
        }
    }
  console.log('Constellation geometry', JSON.stringify(measured));
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
