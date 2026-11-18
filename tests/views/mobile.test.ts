import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  areaFactor,
  areaUnit,
  indexMobile,
  mass,
  mobileArms,
  mobileLayout,
  mobileWindow,
  reorder,
  supportTree,
  swing,
  swingReach,
  tiltName,
} from '../../src/views/mobile/model';
import type { ViewFrame, ViewNote } from '../../src/views/types';

let frame: ViewFrame;
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  frame = scoreFrame(state.rows.length);
  frame.lookAhead = 1;
  frame.instruments.forEach((p, i) => {
    p.id = state.rows[i].id;
    p.name = state.rows[i].name;
  });
  const entries = await Promise.all(
    state.rows.map(
      async (row) =>
        [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 4, 17)] as const,
    ),
  );
  for (const [, result] of entries) expect(result.error).toBeNull();
  frame.notes = viewNotes({ from: 4, to: 17, events: Object.fromEntries(entries) });
});
it('hangs every real bar-11 note and balances its actual mass, including future notes', () => {
  const score = indexMobile(frame.notes),
    arms = mobileArms(frame, score);
  const actual = arms.map((a) => ({
    name: frame.instruments.find((p) => p.id === a.id)!.name,
    count: a.notes.length,
    shape: a.shape,
    tilt: tiltName(a.tilt),
  }));
  console.log('Mobile bar 11:', actual);
  expect(actual.map((a) => a.count)).toEqual([1, 1, 8, 2, 1, 1]);
  expect(actual.map((a) => a.shape)).toEqual([
    'bead',
    'bead',
    'bead',
    'bead',
    'crystal',
    'crystal',
  ]);
  expect(actual.map((a) => a.tilt)).toEqual([
    'left dips',
    'level',
    'left dips',
    'level',
    'left dips',
    'left dips',
  ]);
  expect(arms.reduce((n, a) => n + a.notes.length, 0)).toBe(14);
  for (const a of arms) {
    expect(a.weights.reduce((n, w) => n + w.notes.length, 0)).toBe(a.notes.length);
    expect(a.mass).toBeCloseTo(a.notes.reduce((n, note) => n + mass(note), 0));
  }
  expect(arms[1].weights[0].passed).toBe(0);
  expect(mobileWindow(frame)).toEqual({ from: 10, to: 11 });
  expect(mobileWindow({ ...frame, lookAhead: 4 })).toEqual({ from: 10, to: 14 });
  const renamed = indexMobile(
    frame.notes.map((n) => ({ ...n, value: { ...n.value, s: 'anything' } })),
  );
  expect(renamed.shapes).toEqual(score.shapes);
});
it('is pure in time, and assigns a fixed onset slot independently of other notes', () => {
  const score = indexMobile(frame.notes);
  const original = mobileArms(frame, score);
  mobileArms({ ...frame, now: 18.9 }, score);
  expect(mobileArms(frame, score)).toEqual(original);
  const note = original[2].notes[3];
  const lone = mobileArms(frame, indexMobile([note]))[0].weights[0];
  const crowded = original[2].weights.find((w) => w.notes.includes(note))!;
  expect(lone.position).toBe(crowded.position);
  expect(swing(note, note.start - 1)).toBe(0);
  expect(swing(note, note.start)).toBe(0);
  expect(swing({ ...note, hasOnset: false }, note.start + 0.1)).toBe(0);
  expect(Math.abs(swing(note, note.start + 2.1))).toBeLessThan(0.002);
});
it('counts dense coincident polyphony, collapses only repeated control fragments, and preserves zero gain', () => {
  const note = frame.notes.find((n) => n.start === 10)!;
  const copies: ViewNote[] = Array.from({ length: 500 }, () => ({ ...note }));
  const source = [...copies, ...copies.map((n) => ({ ...n, hasOnset: false }))];
  const score = indexMobile(source);
  expect(score.notes).toHaveLength(500);
  const arm = mobileArms(frame, score)[0];
  expect(arm.weights).toHaveLength(1);
  expect(arm.weights[0].notes).toHaveLength(500);
  expect(arm.mass).toBeCloseTo(500 * mass(note));
  const silent = { ...note, value: { gain: 0 } };
  expect(mass(silent)).toBe(0);
  expect(mobileArms(frame, indexMobile([silent]))[0].notes).toHaveLength(1);
  expect(mass({ ...note, value: {} })).toBe(note.end - note.start);
  expect(mass({ ...note, value: { gain: 2 } })).toBe((note.end - note.start) * 2);
  const carried = { ...note, start: 9, end: 12, hasOnset: false };
  expect(mobileArms(frame, indexMobile([carried, carried]))[0].notes).toHaveLength(1);
});
it('keeps rods in the canopy, weights in separate bays, and a common exact area scale at both stage sizes', () => {
  const score = indexMobile(frame.notes);
  for (const [width, height] of [
    [1300, 760],
    [1131, 469],
    [559, 675],
  ]) {
    const base = mobileArms(frame, score),
      box = mobileLayout(width, height, base.length);
    const arms = mobileArms(frame, score, [], box.slots),
      unit = areaUnit(arms, box);
    const tree = supportTree(box, arms.length);
    expect(tree.rods).toHaveLength(arms.length - 1);
    for (const rod of tree.rods) {
      expect(rod.y).toBeLessThan(box.armY);
      expect(rod.children.every((c) => c.y > rod.y)).toBe(true);
    }
    for (const arm of arms)
      for (const w of arm.weights) {
        const r = Math.sqrt((w.mass * unit) / areaFactor(arm.shape));
        expect(areaFactor(arm.shape) * r * r).toBeCloseTo(w.mass * unit);
        const right = Math.abs(w.position * box.half) + swingReach(arm, w, box, r) + r;
        expect(right).toBeLessThan(box.bay / 2);
        const low =
          Math.max(...box.armYs) +
          box.half * Math.tan(0.19) +
          box.hang +
          box.maxRadius * 2.2 +
          2 * r;
        expect(low).toBeLessThan(box.bottom - 59);
      }
  }
});
it('reorders view identities without changing the score; reset uses document order', () => {
  const score = indexMobile(frame.notes),
    arms = mobileArms(frame, score),
    ids = arms.map((a) => a.id);
  const order = reorder(ids, ids[0], ids[3]);
  expect(order).toEqual([ids[1], ids[2], ids[3], ids[0], ids[4], ids[5]]);
  expect(mobileArms(frame, score, order).map((a) => a.id)).toEqual(order);
  expect(mobileArms(frame, score).map((a) => a.id)).toEqual(ids);
});

it('retains twenty parts and 500 simultaneous weights without crossing their bay boundaries', () => {
  const f = scoreFrame(20);
  f.lookAhead = 1;
  f.notes = Array.from({ length: 500 }, (_, i) => ({
    instrument: String(i % 20),
    start: 10 + (i % 17) / 20,
    end: 11,
    hasOnset: true,
    value: { note: 24 + (i % 60), gain: 0.5 },
  }));
  const score = indexMobile(f.notes);
  const box = mobileLayout(559, 675, 20);
  const arms = mobileArms(f, score, [], box.slots);
  const unit = areaUnit(arms, box);
  expect(arms).toHaveLength(20);
  expect(arms.reduce((n, a) => n + a.weights.reduce((m, w) => m + w.notes.length, 0), 0)).toBe(500);
  for (const arm of arms)
    for (const w of arm.weights) {
      const radius = Math.sqrt((w.mass * unit) / areaFactor(arm.shape));
      const swingLimit = swingReach(arm, w, box, radius);
      expect(Math.abs(w.position * box.half) + radius + swingLimit).toBeLessThan(box.bay / 2);
    }
});
