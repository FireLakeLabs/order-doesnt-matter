import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { type AppState, initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, neededRange, sectionMembership, viewNotes } from '../../src/studio/frame';
import {
  analyse,
  roles,
  scene,
  searchlight,
  district,
  strideAt,
  accented,
  parallaxRates,
} from '../../src/views/ash-run/model';
import { building, buildingAt, crossing, route, world } from '../../src/views/ash-run/city';
import { crateState, walker } from '../../src/views/ash-run/effects';
import { runPose } from '../../src/views/ash-run/runner';
import { skyline, windowLights, windows } from '../../src/views/ash-run/scenery';
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
  expect(a.key).toBe('cutoff');
  expect(frame.instruments.find((i) => i.id === a.instrument)?.name).toBe('wobbleBass');
  expect(a.value).toBeCloseTo(1370);
  expect(a.angle).toBe(b.angle);
  expect(searchlight({ ...frame, now: 10.51 }, data)!.angle).toBe(a.angle);
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
    const f = { ...scoreFrame(20), width: 960, height: 600, now: 10 };
    f.notes = f.instruments.map((i) => ({
      instrument: i.id,
      start: 10,
      end: 11,
      hasOnset: true,
      value: { note: 48 + i.index + trial },
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

it('keeps a held window on the same cell while it moves at its layer parallax', () => {
  const f = { ...scoreFrame(3), width: 960, height: 600, now: 10 };
  f.notes = f.instruments.map((i) => ({
    instrument: i.id,
    start: 10,
    end: 11,
    hasOnset: true,
    value: { note: 48 + i.index },
  }));
  const data = analyse(f.notes);
  const initial = windowLights(f, scene(f, data), data);
  const anchor = initial.find((w) => w.layer === 1 && w.x > 150 && w.x < f.width - 20 && w.y < 280);
  expect(anchor).toBeDefined();
  if (!anchor) throw Error('Expected an unobscured mid-ground window');
  for (let tick = 1; tick < 100; tick++) {
    const current = { ...f, now: 10 + tick * 0.01 },
      s = scene(current, data);
    const light = windowLights(current, s, data).find(
      (w) =>
        w.id === anchor.id &&
        w.layer === anchor.layer &&
        w.building === anchor.building &&
        w.row === anchor.row &&
        w.column === anchor.column,
    );
    expect(light, String(current.now)).toBeDefined();
    expect(light!.x).toBeCloseTo(anchor.x - s.pace * parallaxRates[anchor.layer] * tick * 0.01);
    expect(light!.y).toBe(anchor.y);
  }
});
it('keeps the drawn walker on the horizon across its former on-screen wrap', () => {
  const noop = () => {};
  const lamps: number[] = [];
  const c = {
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    quadraticCurveTo: noop,
    fill: noop,
    arc: (x: number) => lamps.push(x),
  } as unknown as CanvasRenderingContext2D;
  const f = { ...frame, width: 960, height: 600 },
    data = analyse(f.notes);
  for (const now of [4.19, 4.24, 4.25, 4.26, 4.3, 8.49, 8.5]) {
    const current = { ...f, now };
    walker(c, current, { ...scene(current, data), lamp: false });
  }
  expect(new Set(lamps).size).toBe(1);
});
it('lands inside the next roof even in a very wide stage', () => {
  const w = world({ ...frame, width: 3840, height: 600 });
  for (let i = 0; i < 60; i++) {
    const jump = crossing(w, building(i, w.maxGap));
    expect((jump.landing * w.pace) / w.size).toBeLessThan(jump.to.end);
    expect(route(w, jump.landing).airborne).toBe(false);
    expect(route(w, jump.landing).feet).toBeCloseTo(w.y(jump.to));
  }
});

it('keeps 3,360 simultaneous voices in disjoint windows or fixed subcells with and without siblings', () => {
  for (const width of [560, 960, 1920])
    for (let onset = 0; onset < 40; onset++) {
      const f = { ...scoreFrame(8), width, height: 600, now: onset / 4 };
      f.notes = f.instruments.flatMap((i) =>
        Array.from({ length: 4 }, (_, voice) => ({
          instrument: i.id,
          start: f.now,
          end: f.now + 1,
          hasOnset: true,
          value: { note: 48 + i.index * 4 + voice },
        })),
      );
      const data = analyse(f.notes),
        lights = windowLights(f, scene(f, data), data);
      expect(lights.reduce((sum, w) => sum + w.count, 0)).toBe(28); // Lowest part is the walker.
      for (const instrument of f.instruments.slice(1)) {
        const part = lights.filter((light) => light.id === instrument.id);
        expect(part).toHaveLength(4);
        expect(part.reduce((sum, w) => sum + w.count, 0)).toBe(4);
        expectDisjoint(part);
        for (const light of part) {
          const alone = analyse(
            f.notes.filter(
              (n) =>
                n.instrument !== instrument.id ||
                analyse([n]).parts.get(instrument.id)?.[0].identity === light.identity,
            ),
          );
          const isolated = windowLights(f, scene(f, data), alone).find(
            (w) => w.identity === light.identity,
          )!;
          expect(address(isolated)).toEqual(address(light));
        }
      }
      const byPart = (a: (typeof lights)[number], b: (typeof lights)[number]) =>
        a.id.localeCompare(b.id) || a.x - b.x || a.y - b.y;
      expect(
        windowLights(f, scene(f, data), analyse([...f.notes].reverse())).toSorted(byPart),
      ).toEqual(lights.toSorted(byPart));
    }
});

it('splits colliding identities at fixed positions and badges only identical coincident notes', () => {
  const f = { ...scoreFrame(8), width: 560, height: 600, now: 10 };
  f.notes = f.instruments.flatMap((i) =>
    Array.from({ length: 200 }, (_, voice) => ({
      instrument: i.id,
      start: f.now,
      end: f.now + (voice % 2 ? 1 : 0.5),
      hasOnset: true,
      value: { note: 48 + i.index + voice / 1000 },
    })),
  );
  const data = analyse(f.notes),
    s = scene(f, data),
    lights = windowLights(f, s, data);
  for (const instrument of f.instruments.slice(1)) {
    const part = lights.filter((light) => light.id === instrument.id);
    expect(part.length).toBeGreaterThan(4);
    expect(part).toHaveLength(200);
    expectDisjoint(part);
    expect(
      new Set(part.map((w) => `${w.layer}:${w.building}:${w.row}:${w.column}:${w.subcell}`)).size,
    ).toBe(part.length);
    expect(new Set(part.map((w) => `${w.layer}:${w.building}`)).size).toBeGreaterThan(1);
    expect(part.reduce((sum, w) => sum + w.count, 0)).toBe(200);
    expect(part.every((w) => w.count === 1)).toBe(true);
    const collision = part.find((w) => w.split)!;
    expect(collision).toBeDefined();
    const withoutSiblings = analyse(
      f.notes.filter(
        (n) =>
          n.instrument !== instrument.id ||
          analyse([n]).parts.get(instrument.id)?.[0].identity === collision.identity,
      ),
    );
    const alone = windowLights(f, s, withoutSiblings).find(
      (w) => w.identity === collision.identity,
    )!;
    expect(address(alone)).toEqual(address(collision));
    expect(alone.split).toBe(false);
  }
  const doubled = analyse([...f.notes, ...f.notes]);
  const duplicated = windowLights(f, s, doubled);
  expect(duplicated).toHaveLength(lights.length);
  expect(duplicated.every((w) => w.count === 2)).toBe(true);
  expect(duplicated.map(address)).toEqual(lights.map(address));
  const labels: string[] = [];
  const noop = () => {};
  const c = {
    save: noop,
    restore: noop,
    fillRect: noop,
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillText: (text: string) => labels.push(text),
  } as unknown as CanvasRenderingContext2D;
  windows(c, f, s, doubled);
  expect(labels).toEqual(duplicated.map((w) => `×${w.count}`));
});

it('keeps the sweep fixture held windows when shorter chord siblings leave the query', () => {
  const f = { ...scoreFrame(10), width: 1131, height: 468, now: 4.01 };
  f.notes = Array.from({ length: 8 }, (_, i) =>
    Array.from({ length: 4 }, (_, j) => ({
      instrument: String(i),
      start: 0,
      end: j === 3 ? 8 : 0.5,
      hasOnset: true,
      value: { s: 'sawtooth', note: 60 + i * 2 + j },
    })),
  ).flat();
  f.notes.push(
    { instrument: '8', start: 0, end: 8, hasOnset: true, value: { note: 12, s: 'sine' } },
    { instrument: '9', start: 0, end: 0.1, hasOnset: true, value: { note: 120, s: 'triangle' } },
  );
  const data = analyse(f.notes),
    s = scene(f, data);
  const full = windowLights(f, s, data);
  const trimmed = windowLights(f, s, analyse(f.notes.filter((n) => n.end > 1)));
  expect(full.some((w) => w.id === '4')).toBe(true);
  expect(trimmed).toEqual(full);
});

type Light = ReturnType<typeof windowLights>[number];
function address(w: Light) {
  return [w.layer, w.building, w.row, w.column, w.offsetX, w.offsetY, w.subcell, w.x, w.y];
}
function expectDisjoint(lights: Light[]) {
  const cells = new Map<string, Light[]>();
  for (const light of lights) {
    const key = `${light.layer}:${light.building}:${light.row}:${light.column}`;
    const cell = cells.get(key) ?? [];
    cell.push(light);
    cells.set(key, cell);
  }
  for (const cell of cells.values()) {
    cell.sort((a, b) => a.x - b.x);
    for (const [index, light] of cell.entries()) {
      expect(light.width).toBeGreaterThan(0);
      if (index) expect(cell[index - 1].x + cell[index - 1].width).toBeLessThanOrEqual(light.x);
    }
  }
}

it('keeps each real dubstep note address when expired siblings leave the query across the whole arrangement', async () => {
  const whole = await queried(0, { from: 0, to: 28 });
  const data = analyse(whole.notes);
  let compared = 0;
  for (const width of [560, 960, 1920]) {
    const times = new Set(whole.notes.map((n) => n.start + (n.end - n.start) / 2));
    for (const now of times) {
      const members = sectionMembership(state, now);
      const f = {
          ...whole,
          width,
          now,
          instruments: whole.instruments.map((i) => ({
            ...i,
            inSection: members?.has(i.id) ?? i.inSection,
          })),
        },
        s = scene(f, data);
      const full = windowLights(f, s, data);
      const trimmed = windowLights(
        f,
        s,
        analyse(f.notes.filter((n) => now < Math.max(n.end, n.start + f.cps * 0.18))),
      );
      expect(trimmed.map(address), `${width}:${now}`).toEqual(full.map(address));
      expectDisjoint(full);
      compared += full.reduce((sum, w) => sum + w.count, 0);
    }
  }
  console.log(`Ash Run real-arrangement address comparisons: ${compared}`);
  expect(compared).toBeGreaterThan(0);
});

it('prioritises moving cutoff, then other filters, and uses a moving non-filter only without any filter', () => {
  const f = { ...scoreFrame(3), now: 0.1 };
  f.notes = f.instruments.flatMap((i) =>
    [0, 1].map((start) => ({
      instrument: i.id,
      start,
      end: start + 1,
      hasOnset: true,
      value:
        i.index === 0
          ? { note: 60, cutoff: 850 }
          : i.index === 1
            ? { note: 72, cutoff: 1370 }
            : { s: 'hh', gain: start ? 1 : 0.2 },
    })),
  );
  f.instruments[1].settings = [{ name: 'lpf', label: 'Cutoff', kind: 'signal' }];
  const choose = () => searchlight(f, analyse(f.notes));
  expect(choose()).toMatchObject({ instrument: '1', key: 'cutoff', value: 1370 });
  f.instruments[1].settings = [];
  expect(choose()).toMatchObject({ instrument: '0', key: 'cutoff', value: 850 });
  f.notes = f.notes.map((n) => ({
    ...n,
    value: n.instrument === '1' ? { note: 72, hpf: 500 + n.start * 500 } : n.value,
  }));
  expect(choose()).toMatchObject({ instrument: '1', key: 'hpf', value: 500 });
  f.notes = f.notes.filter((n) => n.instrument === '2');
  expect(choose()).toMatchObject({ instrument: '2', key: 'gain', value: 0.2 });
  expect(searchlight({ ...f, now: 0.9 }, analyse(f.notes))?.angle).toBe(choose()?.angle);
  expect(searchlight({ ...f, now: 1.1 }, analyse(f.notes))?.angle).not.toBe(choose()?.angle);
});

it('keeps split positions fixed when colliding siblings disappear or reverse order', () => {
  const f = { ...scoreFrame(2), width: 960, height: 600, now: 10 };
  f.notes = [
    { instrument: '0', start: 10, end: 18, hasOnset: true, value: { note: 12 } },
    ...[60, 64, 67, 72].map((note) => ({
      instrument: '1',
      start: 10,
      end: note === 72 ? 18 : 11,
      hasOnset: true,
      value: { note },
    })),
  ];
  const data = analyse(f.notes),
    s = scene(f, data);
  // Force a facade collision; the independently hashed subcell must still separate every identity.
  const collide = (notes: typeof f.notes) => {
    const result = analyse(notes);
    for (const e of result.parts.get('1') ?? []) e.seed = 7;
    return result;
  };
  const full = windowLights(f, s, collide(f.notes));
  expect(full).toHaveLength(4);
  expect(full.every((w) => w.split)).toBe(true);
  expectDisjoint(full);
  const fewer = windowLights(f, s, collide(f.notes.filter((n) => n.value.note !== 64)));
  expect(fewer).toHaveLength(3);
  for (const light of fewer) {
    expect(light.split).toBe(true);
    expect(address(light)).toEqual(address(full.find((w) => w.identity === light.identity)!));
  }
  const reverse = collide([...f.notes].reverse());
  expect(windowLights(f, s, reverse)).toEqual(full);
});
