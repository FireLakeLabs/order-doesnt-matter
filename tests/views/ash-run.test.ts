import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { type AppState, initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, neededRange, viewNotes } from '../../src/studio/frame';
import {
  analyse,
  roles,
  scene,
  searchlight,
  district,
  strideAt,
  accented,
} from '../../src/views/ash-run/model';
import { building, buildingAt, crossing, route, world } from '../../src/views/ash-run/city';
import { crateState } from '../../src/views/ash-run/effects';
import { runPose } from '../../src/views/ash-run/runner';
import { skyline, windowLights } from '../../src/views/ash-run/scenery';
import type { ViewFrame } from '../../src/views/types';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
let state: AppState;
let frame: ViewFrame;
async function queried(now: number, range?: { from: number; to: number }, piece = state) {
  const span = range ?? neededRange(undefined, now, 1, piece.sections);
  const entries = await Promise.all(
    piece.rows.map(
      async (row) =>
        [
          row.id,
          await queryEventsNode(generate(piece.doc!, { only: row.id }), span.from, span.to),
        ] as const,
    ),
  );
  for (const [, r] of entries) expect(r.error).toBeNull();
  const score = { ...span, events: Object.fromEntries(entries) };
  return buildFrame({
    state: piece,
    score,
    notes: viewNotes(score),
    now,
    cps: 140 / 240,
    playing: false,
    theme: scoreFrame().theme,
    lookAhead: 1,
    trails: 1,
    width: 960,
    height: 600,
    dpr: 1,
  });
}
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  state = loadPiece(initialState(), source, importStrudel(source));
  frame = await queried(10.4);
});

it('selects musical roles by scored timing and pitch, independent of names', () => {
  const chosen = roles(frame, analyse(frame.notes));
  const name = (id: string | undefined) => frame.instruments.find((i) => i.id === id)?.name;
  expect(
    [chosen.walker, chosen.footfalls, chosen.snare, chosen.kick, chosen.openHat].map(name),
  ).toEqual(['subBass', 'hh · drop', 'sd · drop', 'bd', 'oh']);
  const renamed = {
    ...frame,
    instruments: frame.instruments.map((i) => ({ ...i, name: 'x' })),
    notes: frame.notes.map((n) => ({ ...n, value: { ...n.value, s: 'x' } })),
  };
  expect(roles(renamed, analyse(renamed.notes))).toEqual(chosen);
});
it('builds a city from distance alone with bounded roofs, gaps and floor changes', () => {
  for (let index = -200; index < 200; index++) {
    const b = building(index),
      next = building(index + 1);
    expect(b.end - b.start).toBeGreaterThanOrEqual(6 - 1e-9);
    expect(b.end - b.start).toBeLessThanOrEqual(20 + 1e-9);
    expect(b.gap).toBeGreaterThanOrEqual(1.2);
    expect(b.gap).toBeLessThanOrEqual(2.2);
    expect(next.start - b.end).toBeCloseTo(b.gap);
    expect(next.floors - b.floors).toBeLessThanOrEqual(2);
    expect(buildingAt((b.start + b.end) / 2)).toEqual(b);
  }
  const a = scene(frame, analyse(frame.notes)),
    b = scene({ ...frame, notes: [] }, analyse([]));
  expect(a.buildings).toEqual(b.buildings);
  for (let layer = 0; layer < 3; layer++)
    expect(skyline(frame, a, layer)).toEqual(skyline(frame, b, layer));
  expect(a.distance).toBe(b.distance);
  expect(a.size).toBe(54);
  expect(a.speed).toBeGreaterThan(330);
  expect(a.speed).toBeLessThan(380);
  expect(scene({ ...frame, cps: frame.cps * 2 }, analyse(frame.notes)).speed).toBe(a.speed * 2);
});
it('takes off at an edge, follows a ballistic arc, absorbs landing and rolls after three-floor drops', () => {
  const w = world(frame);
  let rolls = 0;
  for (let i = 0; i < 60; i++) {
    const b = building(i),
      jump = crossing(w, b),
      mid = (jump.takeoff + jump.landing) / 2;
    const seconds = (jump.landing - jump.takeoff) / frame.cps;
    expect(seconds).toBeGreaterThanOrEqual(0.3);
    expect(seconds).toBeLessThanOrEqual(0.45);
    expect(route(w, jump.takeoff - 1e-7).feet).toBeCloseTo(w.y(b));
    expect(route(w, jump.takeoff).feet).toBeCloseTo(w.y(b));
    expect(route(w, mid).airborne).toBe(true);
    expect(route(w, mid).feet).toBeLessThan((w.y(b) + w.y(jump.to)) / 2);
    expect(route(w, jump.landing).feet).toBeCloseTo(w.y(jump.to));
    expect(route(w, jump.landing).airborne).toBe(false);
    expect(route(w, jump.landing + 0.05 * frame.cps).absorb).toBeCloseTo(1);
    if (jump.drop) {
      rolls++;
      expect(route(w, jump.landing + 0.12 * frame.cps).roll).toBeDefined();
    }
    expect(route(w, jump.landing + 0.4 * frame.cps).roll).toBeUndefined();
  }
  expect(rolls).toBeGreaterThan(0);
});
it('continues running through the breakdown without a bass-created chasm', async () => {
  const f = await queried(17.4),
    s = scene(f, analyse(f.notes));
  expect(s.district.name).toBe('docks');
  expect(s.buildings.length).toBeGreaterThan(2);
  expect(Number.isFinite(s.feet)).toBe(true);
  const empty = scene({ ...f, notes: [] }, analyse([]));
  expect(empty.feet).toBe(s.feet);
  expect(empty.airborne).toBe(s.airborne);
});
it('changes district exactly at a section line and reuses a returning section name', () => {
  const sections = [
    { name: 'A', from: 0, to: 4 },
    { name: 'B', from: 4, to: 8 },
    { name: 'C', from: 8, to: 16 },
    { name: 'D', from: 16, to: 20 },
    { name: 'C', from: 20, to: 28 },
  ];
  expect([3.999, 4, 8, 16, 20, 28].map((now) => district({ now, sections }).name)).toEqual([
    'old town',
    'construction',
    'downtown',
    'docks',
    'downtown',
    'old town',
  ]);
});
it('contacts on steady drum notes, uses six distinct poses and falls back to tempo in silence', () => {
  const data = analyse(frame.notes),
    r = roles(frame, data);
  const hits = data.parts
    .get(r.footfalls!)!
    .filter((e) => e.note.hasOnset && e.note.start >= 10 && e.note.start < 11);
  for (let i = 0; i < hits.length - 1; i++) {
    const now = hits[i].note.start;
    expect(strideAt({ ...frame, now }, data, r.footfalls).phase).toBe(0);
    expect(
      strideAt({ ...frame, now: (now + hits[i + 1].note.start) / 2 }, data, r.footfalls).phase,
    ).toBeCloseTo(0.5);
  }
  expect(new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => JSON.stringify(runPose(p)))).size).toBe(6);
  expect(strideAt({ ...frame, now: 0.125 }, analyse([]), undefined).phase).toBe(0.5);
});
it('vaults on the snare, crashes on range-relative accents and keeps an airborne crate on the next roof', () => {
  const data = analyse(frame.notes),
    s = scene(frame, data);
  const hit = data.parts.get(s.roles.snare!)!.find((e) => !route(s, e.note.start).airborne)!;
  const onHit = scene({ ...frame, now: hit.note.start }, data);
  expect(onHit.vault).toBeCloseTo(0.5);
  expect(onHit.feet).toBeLessThan(route(s, hit.note.start).feet);
  const b = building(8),
    jump = crossing(s, b);
  const airHit = { ...hit, note: { ...hit.note, start: (jump.takeoff + jump.landing) / 2 } };
  const tumbling = crateState(s, airHit, airHit.note.start + 0.1);
  expect(tumbling.tumble).toBe(true);
  for (const phase of [0.5, 0.99]) {
    const airborneHit = {
      ...hit,
      note: { ...hit.note, start: jump.takeoff + (jump.landing - jump.takeoff) * phase },
    };
    const landed = crateState(s, airborneHit, airborneHit.note.start + 0.3);
    expect(landed.x).toBeGreaterThan(jump.to.start);
    expect(landed.x).toBeLessThan(jump.to.end);
    expect(landed.y).toBe(s.y(jump.to));
  }
  const low = { ...hit.note, value: { gain: 0.2 } },
    high = { ...hit.note, start: hit.note.start + 0.1, value: { gain: 1 } };
  const gains = analyse([low, high]);
  expect(accented({ ...hit, note: low }, gains)).toBe(false);
  expect(accented({ ...hit, note: high }, gains)).toBe(true);
});
it('holds the walker lamp for the scored span and samples moving numeric beam settings without inventing signal values', () => {
  const data = analyse(frame.notes),
    s = scene(frame, data);
  expect(s.lamp).toBe(true);
  const a = searchlight({ ...frame, now: 10.38 }, data)!,
    b = searchlight({ ...frame, now: 10.47 }, data)!;
  expect(a.key).toBe('gain');
  expect(a.angle).toBe(b.angle);
  expect(searchlight({ ...frame, now: 10.51 }, data)!.angle).not.toBe(a.angle);
  expect(scene({ ...frame, notes: [] }, analyse([])).lamp).toBe(false);
});
it('draws the same route and musical pose when revisiting time in either direction and across cache seams', async () => {
  const data = analyse(frame.notes),
    expected = scene(frame, data);
  for (const now of [14, 8, 12, 4, 10.4]) scene({ ...frame, now }, data);
  expect(JSON.stringify(scene(frame, data))).toBe(JSON.stringify(expected));
  for (const now of [8, 12, 20]) {
    const old = neededRange(undefined, now - 0.05, 1, state.sections),
      next = neededRange(undefined, now, 1, state.sections);
    const pose = (f: ViewFrame) => {
      const s = scene(f, analyse(f.notes));
      return { buildings: s.buildings, feet: s.feet, stride: s.stride, roles: s.roles };
    };
    expect(pose(await queried(now, old))).toEqual(pose(await queried(now, next)));
  }
});

it('recognises four-beat backbeats and strong-beat kicks in the other real drum grooves', async () => {
  for (const program of ['real-synthwave', 'real-dnb', 'real-future-bass', 'real-dnb-arranged']) {
    const source = readFileSync(`corpus/programs/${program}.strudel`, 'utf8');
    const piece = loadPiece(initialState(), source, importStrudel(source));
    const f = await queried(2.4, undefined, piece),
      chosen = roles(f, analyse(f.notes));
    expect(f.instruments.find((i) => i.id === chosen.snare)?.name, program).toBe('sd');
    expect(chosen.openHat, program).not.toBe(chosen.snare);
    if (program === 'real-synthwave') {
      expect(f.instruments.find((i) => i.id === chosen.kick)?.name).toBe('bd');
    }
  }
  const bd = frame.instruments.find((i) => i.name === 'bd')!;
  const source = frame.notes.find((n) => n.instrument === bd.id && n.hasOnset)!;
  const notes = Array.from({ length: 16 }, (_, i) => ({
    ...source,
    start: i / 4,
    end: (i + 1) / 4,
  }));
  const f = { ...frame, notes, instruments: [bd] };
  expect(roles(f, analyse(notes)).kick).toBe(bd.id);
});

it('keeps a half-time snare out of the kick role when the kick is syncopated', () => {
  const bd = frame.instruments.find((i) => i.name === 'bd')!;
  const sd = frame.instruments.find((i) => i.name === 'sd · drop')!;
  const source = frame.notes.find((n) => n.instrument === bd.id && n.hasOnset)!;
  const snares = frame.notes.filter((n) => n.instrument === sd.id && n.start >= 8 && n.start < 16);
  for (const phases of [
    [0, 0.375],
    [0, 0.625],
    [0, 0.75, 0.875],
  ]) {
    const notes = [
      ...snares,
      ...Array.from({ length: 8 }, (_, i) =>
        phases.map((phase) => ({
          ...source,
          start: 8 + i + phase,
          end: 8 + i + phase + 0.125,
        })),
      ).flat(),
    ];
    const f = { ...frame, notes, instruments: [bd, sd] };
    const chosen = roles(f, analyse(notes));
    expect(chosen.snare, String(phases)).toBe(sd.id);
    expect(chosen.kick, String(phases)).toBeUndefined();
  }
});

it('preserves unison onsets, folds setting continuations and assigns highest short pitched notes to pigeons', () => {
  const source = frame.notes.find((n) => n.hasOnset && n.start === 10 && n.value.note === 'eb1')!;
  const full = analyse(frame.notes).parts.get(source.instrument)!;
  expect(full.filter((e) => e.note.start === 10 && e.note.end === 11)).toHaveLength(1);
  expect(analyse([source, { ...source }]).parts.get(source.instrument)).toHaveLength(2);
  const fragment = { ...source, hasOnset: false };
  expect(analyse([fragment, { ...fragment }]).parts.get(source.instrument)).toHaveLength(1);
  const notes = ['c3', 'c6'].map((note, index) => ({
    ...source,
    instrument: String(index),
    start: 10,
    end: 10.125,
    value: { note },
  }));
  const f = { ...frame, notes, instruments: scoreFrame(2).instruments };
  expect(roles(f, analyse(notes))).toMatchObject({
    walker: '0',
    openHat: '1',
    footfalls: undefined,
  });
});

it('vaults on every ground-level snare-roll onset even when hits are closer than a vault interval', async () => {
  const f = await queried(5),
    data = analyse(f.notes),
    chosen = roles(f, data);
  const snare = data.parts
    .get(chosen.snare!)!
    .filter((e) => e.note.hasOnset && e.note.start >= 4 && e.note.start < 8);
  let vaults = 0;
  for (const e of snare) {
    if (route(world(f), e.note.start).airborne || accented(e, data)) continue;
    vaults++;
    expect(scene({ ...f, now: e.note.start }, data).vault, String(e.note.start)).toBeCloseTo(0.5);
  }
  expect(vaults).toBeGreaterThan(8);
});

it('gives twenty simultaneous parts disjoint lit windows, so no part can overpaint another', () => {
  for (let trial = 0; trial < 16; trial++) {
    const f = { ...scoreFrame(20), width: 960, height: 600 };
    f.notes = f.instruments.map((i) => ({
      instrument: i.id,
      start: 10 - trial * 0.001,
      end: 11 + trial * 0.001,
      hasOnset: true,
      value: { note: 48 + i.index },
    }));
    const data = analyse(f.notes),
      s = scene(f, data),
      lights = windowLights(f, s, data);
    expect(new Set(lights.map((light) => light.id)).size).toBe(19); // Lowest part is the walker.
    expect(new Set(lights.map((light) => `${light.x},${light.y}`)).size).toBe(lights.length);
  }
});

it('keeps short ballistic jumps at the tall 560 × 760 Stage B size without oversized gaps', () => {
  const f = { ...frame, width: 560, height: 760 },
    w = world(f);
  expect(w.size).toBeCloseTo(68.4);
  expect(w.pace * f.cps).toBeCloseTo((355.8333333333 * 560) / 960);
  for (let i = 0; i < 60; i++) {
    const b = building(i, w.maxGap),
      jump = crossing(w, b);
    expect(b.gap).toBeGreaterThanOrEqual(1.2 - 1e-9);
    expect(b.gap).toBeLessThanOrEqual(2.2);
    expect((jump.landing - jump.takeoff) / f.cps).toBeGreaterThanOrEqual(0.3);
    expect((jump.landing - jump.takeoff) / f.cps).toBeLessThanOrEqual(0.45 + 1e-9);
    expect(route(w, jump.landing).feet).toBeCloseTo(w.y(jump.to));
  }
});
