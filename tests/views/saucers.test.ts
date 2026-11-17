import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { type AppState, initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, neededRange, viewNotes } from '../../src/studio/frame';
import type { ViewFrame } from '../../src/views/types';
import {
  analyse,
  beamPose,
  formation,
  held,
  motherships,
  sectionAt,
} from '../../src/views/saucers/model';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';

let state: AppState;
let frame: ViewFrame;
let programs: { id: string; source: string }[];
async function queried(now: number, from = 0, to = 28) {
  const entries = await Promise.all(
    programs.map(async (p) => [p.id, await queryEventsNode(p.source, from, to)] as const),
  );
  for (const [, result] of entries) expect(result.error).toBeNull();
  const score = { from, to, events: Object.fromEntries(entries) };
  return buildFrame({
    state,
    score,
    notes: viewNotes(score),
    now,
    cps: 140 / 240,
    playing: false,
    theme: scoreFrame().theme,
    lookAhead: 1,
    trails: 1,
    width: 1300,
    height: 760,
    dpr: 1,
  });
}
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  state = loadPiece(initialState(), source, importStrudel(source));
  programs = state.rows.map((row) => ({
    id: row.id,
    source: generate(state.doc!, { only: row.id }),
  }));
  frame = await queried(10.4);
});
it('keeps all thirteen corpus saucers in three squadrons with two lifts and one zap at bar eleven', () => {
  const fleet = formation(frame, analyse(frame.notes));
  expect(fleet.ships).toHaveLength(13);
  expect(fleet.squadron).toBe(true);
  expect(new Set(fleet.ships.map((s) => s.squad)).size).toBe(3);
  expect(fleet.ships.filter((s) => s.lit)).toHaveLength(3);
  const sounding = fleet.ships.flatMap((s) => s.active);
  expect(sounding.filter((e) => held(e.note))).toHaveLength(2);
  expect(sounding.filter((e) => !held(e.note))).toHaveLength(1);
});
it('lifts cargo over the whole scored bass span, scales beam width by gain and stops exactly at its end', () => {
  const fleet = formation(frame, analyse(frame.notes));
  const ships = fleet.ships.filter((s) =>
    s.active.some((e) => e.note.start === 10 && e.note.end === 11),
  );
  expect(ships).toHaveLength(2);
  for (const ship of ships) {
    const event = ship.active.find((e) => e.note.start === 10)!;
    const start = beamPose(event, ship, fleet.ground, 10),
      middle = beamPose(event, ship, fleet.ground, 10.4),
      end = beamPose(event, ship, fleet.ground, 11);
    expect(start.progress).toBe(0);
    expect(middle.progress).toBeCloseTo(0.4);
    expect(end.progress).toBe(1);
    expect(start.y).toBe(fleet.ground - 12);
    expect(middle.y).toBeGreaterThan(end.y);
    expect(end.y).toBeCloseTo(ship.y + ship.size * 0.25);
    const quiet = beamPose(
      { ...event, note: { ...event.note, value: { ...event.note.value, gain: 0.25 } } },
      ship,
      fleet.ground,
      10.4,
    );
    const loud = beamPose(
      { ...event, note: { ...event.note, value: { ...event.note.value, gain: 1 } } },
      ship,
      fleet.ground,
      10.4,
    );
    expect(loud.width).toBeCloseTo(quiet.width * 2);
    const after = formation({ ...frame, now: 11 }, analyse([event.note]));
    expect(after.ships.flatMap((s) => s.active)).toEqual([]);
  }
});
it('uses sounding pitch for altitude, row for unpitched altitude and row index for cargo regardless of names', () => {
  const source = frame.notes.find((n) => n.hasOnset && n.value.note === 'c3')!;
  const instrument = frame.instruments.find((i) => i.id === source.instrument)!;
  const f = { ...frame, instruments: [instrument], now: 0.4 };
  const low = formation(f, analyse([source])).ships[0];
  const high = formation(f, analyse([{ ...source, value: { note: 'c5' } }])).ships[0];
  expect(high.y).toBeLessThan(low.y);
  const unpitched = { ...source, value: { s: 'hh' } };
  const row = formation(f, analyse([unpitched])).ships[0];
  const renamed = formation(
    { ...f, instruments: [{ ...instrument, name: 'bass spaceship cow' }] },
    analyse([unpitched]),
  ).ships[0];
  expect([renamed.x, renamed.y, renamed.cargo]).toEqual([row.x, row.y, row.cargo]);
  const rested = formation({ ...f, now: 2 }, analyse([unpitched])).ships[0];
  expect(rested.lit).toBe(false);
  expect(rested.x).not.toBe(row.x);
  expect(formation(f, analyse([unpitched])).ships[0]).toEqual(row);
});
it('uses only frame.rooms for mothership membership and arrives and leaves at section times including repeats', () => {
  const fleet = formation(frame, analyse(frame.notes));
  const mothers = motherships(frame, fleet.ships);
  expect(mothers).toHaveLength(1);
  expect(mothers[0].orbit).toBe(1);
  expect(mothers[0].members.map((s) => s.instrument.id)).toEqual(frame.rooms[0].members);
  for (const m of mothers)
    for (const member of m.members) {
      const u = (member.y - m.y - 12) / (fleet.ground - m.y - 12);
      const left = (m.x - m.size * 0.25) * (1 - u) + m.lightLeft * u;
      const right = (m.x + m.size * 0.25) * (1 - u) + m.lightRight * u;
      expect(member.x - member.size / 2).toBeGreaterThan(left);
      expect(member.x + member.size / 2).toBeLessThan(right);
    }
  const arbitrary = { ...frame, rooms: [{ orbit: 7, members: [fleet.ships[0].instrument.id] }] };
  expect(motherships(arbitrary, fleet.ships)[0].members).toEqual([fleet.ships[0]]);
  expect(motherships({ ...frame, rooms: [] }, fleet.ships)).toEqual([]);
  expect(sectionAt({ ...frame, now: 15.9 }).presence).toBeCloseTo(0.2);
  expect(sectionAt({ ...frame, now: 16 }).presence).toBe(0);
  expect(sectionAt({ ...frame, now: 16.2 })).toMatchObject({ name: 'breakdown', arriving: true });
  expect(sectionAt({ ...frame, now: 16.2 }).presence).toBeCloseTo(0.4);
  expect(sectionAt({ ...frame, now: 44.2 }).presence).toBeCloseTo(0.4);
  expect(sectionAt({ ...frame, now: 16.6 }).presence).toBe(1);
  expect(sectionAt({ ...frame, sections: [] }).presence).toBe(1);
});
it('folds held setting fragments without deleting true unisons or different pitched fragments', () => {
  const source = frame.notes.find((n) => n.hasOnset && n.start === 10 && n.end === 11)!;
  const prepared = analyse(frame.notes).get(source.instrument)!;
  expect(prepared.filter((e) => e.note.start === 10 && e.note.end === 11)).toHaveLength(1);
  expect(analyse([source, { ...source }]).get(source.instrument)).toHaveLength(2);
  const fragment = { ...source, hasOnset: false };
  expect(analyse([fragment, { ...fragment }]).get(source.instrument)).toHaveLength(1);
  expect(
    analyse([fragment, { ...fragment, value: { note: 'g4' } }]).get(source.instrument),
  ).toHaveLength(2);
  const resumed = formation(frame, analyse([fragment])).ships.find(
    (s) => s.instrument.id === source.instrument,
  )!;
  expect(resumed.active).toHaveLength(1);
  expect(beamPose(resumed.active[0], resumed, frame.height * 0.89, frame.now).progress).toBeCloseTo(
    0.4,
  );
  expect(resumed.events.filter((e) => e.note.hasOnset)).toEqual([]);
});
it('keeps ship and cargo geometry independent of the actual moving host query edges', async () => {
  for (const boundary of [8, 12, 20]) {
    const old = neededRange(undefined, boundary - 0.05, 1, state.sections);
    const next = neededRange(undefined, boundary, 1, state.sections);
    expect(next.from).toBe(old.from + 4);
    const a = await queried(boundary, old.from, old.to),
      b = await queried(boundary, next.from, next.to);
    const poses = (f: ViewFrame) =>
      formation(f, analyse(f.notes)).ships.map((s) => [
        s.instrument.id,
        s.x,
        s.y,
        s.cargo,
        s.active.map((e) => beamPose(e, s, f.height * 0.89, f.now)),
      ]);
    expect(poses(a)).toEqual(poses(b));
  }
});
it('retains five hundred corpus-derived notes and every ship at one and twenty rows, readable on both stages', () => {
  const source = frame.notes.find((n) => n.hasOnset && n.start === 10 && n.end === 11)!;
  for (const count of [1, 20])
    for (const width of [560, 1300])
      for (const height of [468, 760]) {
        const f = { ...scoreFrame(count), width, height, now: 10.4 };
        f.notes = Array.from({ length: 500 }, (_, i) => ({
          ...source,
          instrument: String(i % count),
          value: { ...source.value, note: i % 80 },
        }));
        const fleet = formation(f, analyse(f.notes));
        expect(fleet.ships).toHaveLength(count);
        expect(fleet.ships.reduce((n, s) => n + s.active.length, 0)).toBe(500);
        expect(fleet.squadron).toBe(count > 10);
        for (const ship of fleet.ships) {
          expect(ship.size).toBeGreaterThanOrEqual(44);
          expect(ship.x - ship.size / 2).toBeGreaterThan(0);
          expect(ship.x + ship.size / 2).toBeLessThan(width);
          expect(ship.y).toBeGreaterThan(80);
          expect(ship.y).toBeLessThan(fleet.ground - 20);
        }
      }
  expect(formation({ ...frame, instruments: [], notes: [] }, analyse([])).ships).toEqual([]);
});
