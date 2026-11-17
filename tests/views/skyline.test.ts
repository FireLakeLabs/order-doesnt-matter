import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  cityLayout,
  cityRange,
  cityReadout,
  floorInk,
  indexCity,
} from '../../src/views/skyline/model';
import type { ViewFrame } from '../../src/views/types';

const corpus = new Map<string, ViewFrame>();
beforeAll(async () => {
  for (const file of ['real-dubstep-arranged', 'real-techno']) {
    const source = readFileSync(`corpus/programs/${file}.strudel`, 'utf8');
    const state = loadPiece(initialState(), source, importStrudel(source));
    const frame = scoreFrame(state.rows.length);
    frame.sections = state.sections.map((s) => ({
      name: s.name,
      from: s.start,
      to: s.start + s.cycles,
    }));
    frame.to = frame.sections.at(-1)?.to ?? 16;
    const entries = await Promise.all(
      state.rows.map(
        async (row) =>
          [
            row.id,
            await queryEventsNode(generate(state.doc!, { only: row.id }), 0, frame.to),
          ] as const,
      ),
    );
    for (const [, result] of entries) expect(result.error).toBeNull();
    frame.notes = viewNotes({ from: 0, to: frame.to, events: Object.fromEntries(entries) });
    frame.instruments.forEach((i, n) => {
      i.id = state.rows[n].id;
      i.name = state.rows[n].name;
    });
    corpus.set(file, frame);
  }
});

it('makes a building per real cycle, districts per section and compact floors in row order', () => {
  const frame = corpus.get('real-dubstep-arranged')!;
  const city = indexCity(frame);
  expect(city.buildings).toHaveLength(28);
  expect(city.districts).toEqual(frame.sections);
  expect(city.maxFloors).toBe(6);
  expect(city.buildings.map((b) => b.floors.length)).toEqual([
    3, 3, 3, 3, 3, 3, 3, 4, 6, 6, 6, 6, 6, 6, 6, 6, 3, 3, 3, 3, 6, 6, 6, 6, 6, 6, 6, 6,
  ]);
  for (const b of city.buildings) {
    const notes = frame.notes.filter((n) => n.start < b.bar + 1 && n.end > b.bar);
    expect(b.floors.map((f) => f.instrument)).toEqual(
      frame.instruments.filter((i) => notes.some((n) => n.instrument === i.id)).map((i) => i.id),
    );
    for (const floor of b.floors) {
      expect(floor.windows).toEqual(
        notes
          .filter((n) => n.instrument === floor.instrument)
          .map((n) => ({ start: Math.max(b.bar, n.start), end: Math.min(b.bar + 1, n.end) }))
          .sort((a, b) => a.start - b.start || a.end - b.end),
      );
    }
  }
  const renamed = {
    ...frame,
    instruments: frame.instruments
      .map((i) => ({ ...i, name: 'anything', sounding: false, inSection: false }))
      .reverse(),
  };
  expect(indexCity(renamed)).toEqual(city);
});

it('lights real windows at their starts, retains played windows and is independent of seek order', () => {
  const city = indexCity(corpus.get('real-dubstep-arranged')!);
  const at = cityReadout(city, 10.4);
  expect(at.currentTotal).toBe(16);
  expect(at).toEqual({ lit: 135, total: 417, currentLit: 10, currentTotal: 16 });
  expect(at.lit).toBe(
    city.buildings.flatMap((b) => b.floors.flatMap((f) => f.windows)).filter((w) => w.start <= 10.4)
      .length,
  );
  expect(cityReadout(city, 10.5).currentLit).toBeGreaterThan(at.currentLit);
  cityReadout(city, 24.9);
  expect(cityReadout(city, 10.4)).toEqual(at);
  expect(cityReadout(city, 0).lit).toBeGreaterThan(0);
});

it('scaffolds only uncovered cycles, including a new repeat before the host answers', () => {
  const frame = corpus.get('real-dubstep-arranged')!;
  const city = indexCity({ ...frame, from: 8.25, to: 12, notes: [] });
  expect(city.buildings.filter((b) => b.knownTo > b.knownFrom).map((b) => b.bar)).toEqual([
    8, 9, 10, 11,
  ]);
  expect(city.buildings[8]).toMatchObject({ knownFrom: 8.25, knownTo: 9, floors: [] });
  // Known empty cycles are silence, not scaffolding; notes never decide coverage.
  expect(city.buildings[9]).toMatchObject({ knownFrom: 9, knownTo: 10, floors: [] });
  const pending = indexCity({ ...frame, now: 38.4 });
  expect(cityRange({ ...frame, now: 38.4 })).toEqual([28, 56]);
  expect(pending.buildings.every((b) => b.knownTo <= b.knownFrom)).toBe(true);
  const repeat = indexCity({
    ...frame,
    now: 38.4,
    from: 28,
    to: 56,
    notes: frame.notes.map((n) => ({ ...n, start: n.start + 28, end: n.end + 28 })),
  });
  expect(repeat.districts[0].from).toBe(28);
  expect(cityReadout(repeat, 38.4)).toEqual(cityReadout(indexCity(frame), 10.4));
});

it('shows an honest 16-cycle sample without sections and clips sustained windows at each building', () => {
  const frame = corpus.get('real-techno')!;
  const city = indexCity(frame);
  expect(city.arranged).toBe(false);
  expect(city.buildings).toHaveLength(16);
  expect(city.districts).toHaveLength(0);
  const long = frame.notes[0];
  const held = indexCity({ ...frame, notes: [{ ...long, start: 0.25, end: 3.5 }] });
  expect(held.buildings.slice(0, 4).flatMap((b) => b.floors.flatMap((f) => f.windows))).toEqual([
    { start: 0.25, end: 1 },
    { start: 1, end: 2 },
    { start: 2, end: 3 },
    { start: 3, end: 3.5 },
  ]);
  expect(cityReadout(held, 1.4).lit).toBe(2);
});

it('preserves true horizontal spans and fills stage height on both stages with 1 or 20 instruments', () => {
  const frame = corpus.get('real-dubstep-arranged')!;
  const city = indexCity(frame);
  for (const [width, height] of [
    [1300, 760],
    [559, 675],
    [559, 471],
  ]) {
    const box = cityLayout(city, width, height, frame.instruments.length);
    expect(box.street - box.top).toBeGreaterThan(height * 0.4);
    expect(box.y(city.maxFloors - 1)).toBeLessThan(box.top + box.pitch);
    expect(box.windowHeight).toBeGreaterThan(20);
    const floor = city.buildings[10].floors[0];
    const ink = floorInk(floor, 10, box.innerWidth, false);
    expect(ink.dense).toBe(width < 600);
    if (ink.dense) continue;
    expect(ink.windows[0].x).toBeCloseTo((floor.windows[0].start - 10) * box.innerWidth);
    expect(ink.windows[0].width).toBeCloseTo(
      (floor.windows[0].end - floor.windows[0].start) * box.innerWidth,
    );
  }
  for (const count of [1, 20]) {
    const f = scoreFrame(count);
    f.notes = f.instruments.map((i) => ({
      ...frame.notes[0],
      instrument: i.id,
      start: 10,
      end: 11,
    }));
    const c = indexCity(f),
      box = cityLayout(c, 559, 471, count);
    expect(c.maxFloors).toBe(count);
    expect(box.windowHeight).toBeGreaterThan(4);
    expect(box.y(count - 1)).toBeGreaterThan(box.top);
  }
});

it('turns dense real-note floors into bands without dropping any notes and thins over 200 cycles', () => {
  const frame = corpus.get('real-techno')!;
  const note = frame.notes[0];
  const notes = Array.from({ length: 500 }, (_, i) => ({
    ...note,
    start: 10 + i / 500,
    end: 10 + (i + 1) / 500,
  }));
  const city = indexCity({ ...frame, notes });
  const floor = city.buildings[10].floors[0];
  expect(floor.windows).toHaveLength(500);
  const ink = floorInk(floor, 10, 14, false);
  expect(ink.dense).toBe(true);
  expect(ink.windows.reduce((sum, w) => sum + w.width, 0)).toBeCloseTo(14);
  expect(cityReadout(city, 10.4)).toMatchObject({ total: 500, currentTotal: 500, currentLit: 201 });
  const longCity = indexCity({
    ...frame,
    sections: [{ name: 'long', from: 0, to: 201 }],
    to: 201,
    notes: Array.from({ length: 201 }, (_, i) => ({ ...note, start: i, end: i + 1 })),
  });
  expect(longCity.silhouette).toBe(true);
  expect(longCity.buildings).toHaveLength(201);
  expect(longCity.starts).toHaveLength(201);
  expect(floorInk(longCity.buildings[0].floors[0], 0, 2, true).dense).toBe(true);
});
