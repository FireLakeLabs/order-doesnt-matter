import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import type { ViewFrame, ViewNote } from '../../src/views/types';
import { pitch } from '../../src/views/shared/pitch';
import { fountainSpark, indexShells, shellSpark, sky } from '../../src/views/fireworks/model';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';

let frame: ViewFrame;
let programs: Map<string, string>;
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  programs = new Map(state.rows.map((row) => [row.id, generate(state.doc!, { only: row.id })]));
  const entries = await Promise.all(
    state.rows.map(
      async (row) => [row.id, await queryEventsNode(programs.get(row.id)!, 0, 28)] as const,
    ),
  );
  for (const [, result] of entries) expect(result.error).toBeNull();
  frame = {
    ...scoreFrame(state.rows.length),
    lookAhead: 1,
    notes: viewNotes({ from: 0, to: 28, events: Object.fromEntries(entries) }),
    sections: state.sections.map((s) => ({ name: s.name, from: s.start, to: s.start + s.cycles })),
  };
  frame.instruments.forEach((instrument, i) => {
    instrument.id = state.rows[i].id;
    instrument.name = state.rows[i].name;
  });
});
const single = (note: ViewNote, now: number): ViewFrame => ({
  ...frame,
  now,
  notes: [note],
  instruments: [frame.instruments.find((i) => i.id === note.instrument)!],
});
const shellAt = (note: ViewNote, now: number) => sky(single(note, now)).shells[0];

it('launches exactly one Window ahead and switches flight to burst at the real onset', () => {
  const note = frame.notes.find((n) => n.hasOnset && n.start === 10.5)!;
  expect(note).toBeDefined();
  expect(sky(single(note, note.start - 1.001)).shells).toHaveLength(0);
  const launch = shellAt(note, note.start - 1),
    middle = shellAt(note, note.start - 0.5);
  expect(launch.flight).toBe(0);
  expect(launch.y).toBeCloseTo(frame.height * 0.9);
  expect(middle.y).toBeLessThan(launch.y);
  expect(middle.y).toBeGreaterThan(middle.targetY);
  const before = sky(single(note, note.start - 0.00001)),
    onset = sky(single(note, note.start));
  expect(before.flying).toBe(1);
  expect(before.bursting).toBe(0);
  expect(onset.flying).toBe(0);
  expect(onset.bursting).toBe(1);
  expect(onset.shells[0].y).toBeCloseTo(onset.shells[0].targetY);
  expect(shellSpark(onset.shells[0], 0).x).toBe(onset.shells[0].targetX);
  expect(sky({ ...single(note, note.start - 1.5), lookAhead: 2 }).flying).toBe(1);
});
it('maps real pitch up, gain to size and onset phase to a pad-local horizontal nudge', () => {
  const low = frame.notes.find((n) => n.hasOnset && n.start === 10 && pitch(n.value) === 27)!;
  const high = frame.notes.find((n) => n.hasOnset && n.start === 10 && pitch(n.value) === 39)!;
  expect(low).toBeDefined();
  expect(high).toBeDefined();
  expect(shellAt(high, 10.4).targetY).toBeLessThan(shellAt(low, 10.4).targetY);
  const loud = shellAt({ ...low, value: { ...low.value, gain: 1 } }, 10.4);
  const quiet = shellAt({ ...low, value: { ...low.value, gain: 0.25 } }, 10.4);
  expect(loud.radius).toBe(quiet.radius * 2);
  const early = shellAt(low, 10.1),
    late = shellAt({ ...low, start: 10.5, end: 11.5 }, 10.6);
  expect(early.pad).toBe(late.pad);
  expect(late.targetX).toBeGreaterThan(early.targetX);
  const drum = frame.notes.find(
    (n) => n.hasOnset && n.start === 10 && pitch(n.value) === undefined,
  )!;
  expect(shellAt(drum, 10.01).targetY).toBe(
    shellAt({ ...drum, start: 10.5, end: 10.625 }, 10.51).targetY,
  );
  const other = frame.notes.find(
    (n) =>
      n.hasOnset &&
      n.start === 10.5 &&
      n.instrument !== drum.instrument &&
      pitch(n.value) === undefined,
  )!;
  expect(shellAt(other, 10.51).targetY).not.toBe(shellAt(drum, 10.01).targetY);
});
it('holds willows for the scored span with increasing droop even with Trails off; Trails extends sparks', () => {
  const held = frame.notes.find((n) => n.hasOnset && n.start === 10 && pitch(n.value) === 27)!;
  const early = shellAt(held, 10.1),
    late = shellAt(held, 10.8);
  expect(early.willow).toBe(true);
  expect(late.droop).toBeGreaterThan(early.droop);
  expect(sky({ ...single(held, 10.8), trails: 0 }).bursting).toBe(1);
  expect(sky({ ...single(held, held.end + 0.2), trails: 0 }).bursting).toBe(0);
  expect(sky({ ...single(held, held.end + 0.2), trails: 1 }).bursting).toBe(1);
  expect(sky({ ...single(held, held.end + 0.6), trails: 1 }).bursting).toBe(0);
  expect(sky({ ...single(held, held.end + 0.6), trails: 2 }).bursting).toBe(1);
  const short = frame.notes.find((n) => n.hasOnset && n.start === 10 && n.end - n.start < 0.25)!;
  expect(shellAt(short, 10.01).willow).toBe(false);
});
it('keeps every visible real onset, ignores fragments and reproduces the same seeded sky after seeking', () => {
  const groups = indexShells(frame.notes),
    original = sky(frame, groups);
  expect(original.flying).toBeGreaterThan(0);
  expect(original.bursting).toBeGreaterThan(0);
  expect(original.shells.length).toBe(original.flying + original.bursting);
  for (const shell of original.shells) expect(shell.event.note.hasOnset).toBe(true);
  const wanted = shellSpark(original.shells[0], 3);
  sky({ ...frame, now: 0 }, groups);
  sky({ ...frame, now: 25 }, groups);
  expect(sky(frame, groups)).toEqual(original);
  expect(shellSpark(sky(frame, groups).shells[0], 3)).toEqual(wanted);
  const fragment = { ...frame.notes.find((n) => n.hasOnset)!, hasOnset: false };
  expect(sky(single(fragment, fragment.start)).shells).toHaveLength(0);
  const renamed = sky({
    ...frame,
    instruments: frame.instruments.map((i) => ({ ...i, name: 'snare bass' })),
  });
  expect(renamed.shells.map((s) => [s.x, s.y, s.willow])).toEqual(
    original.shells.map((s) => [s.x, s.y, s.willow]),
  );
});
it('merges all 500 onsets into counted fountains for one or twenty instruments, including future shells', () => {
  const real = frame.notes.find((n) => n.hasOnset && n.start === 10)!;
  for (const count of [1, 20]) {
    const dense = { ...scoreFrame(count), now: 10.4, lookAhead: 1, width: 560 };
    dense.notes = dense.instruments.flatMap((i) =>
      Array.from({ length: 500 }, (_, k) => ({
        ...real,
        instrument: i.id,
        start: 10 + k / 500,
        end: 11 + k / 500,
      })),
    );
    const scene = sky(dense);
    expect(scene.shells).toHaveLength(0);
    expect(scene.fountains).toHaveLength(count);
    expect(scene.flying + scene.bursting).toBe(500 * count);
    for (const f of scene.fountains) {
      expect(f.count).toBe(500);
      expect(f.flying + f.bursting).toBe(500);
      expect(f.pad).toBeGreaterThan(0);
      expect(f.pad).toBeLessThan(560);
      expect(Object.values(fountainSpark(f, 2, 10.4, scene.floor)).every(Number.isFinite)).toBe(
        true,
      );
      const original = fountainSpark(f, 2, 10.4, scene.floor);
      fountainSpark(f, 2, 3, scene.floor);
      expect(fountainSpark(f, 2, 10.4, scene.floor)).toEqual(original);
    }
  }
});
it('fires a section ring on its exact start and again on subsequent song iterations', () => {
  expect(sky({ ...frame, now: 8 }).rings.map((r) => r.name)).toEqual([frame.sections[2].name]);
  expect(sky({ ...frame, now: 7.999 }).rings).toHaveLength(0);
  expect(sky({ ...frame, now: 8.7 }).rings).toHaveLength(0);
  expect(sky({ ...frame, now: 36 }).rings).toEqual(sky({ ...frame, now: 8 }).rings);
  expect(sky({ ...frame, notes: [], instruments: [], sections: [] }).shells).toHaveLength(0);
});

it('reconstructs carried-in willows from whole spans when the real question starts after their onset', async () => {
  const held = frame.notes.find((n) => n.hasOnset && n.start === 10 && pitch(n.value) === 27)!;
  const result = await queryEventsNode(programs.get(held.instrument)!, 10.2, 12);
  expect(result.error).toBeNull();
  const notes = viewNotes({ from: 10.2, to: 12, events: { [held.instrument]: result } });
  const carry = notes.find((n) => n.start === held.start && n.end === held.end)!;
  expect(carry.hasOnset).toBe(false);
  const scene = sky({ ...single(carry, 10.4), from: 10.2, to: 12 });
  expect(scene.flying).toBe(0);
  expect(scene.bursting).toBe(1);
  expect(shellSpark(scene.shells[0], 3)).toEqual(shellSpark(shellAt(held, 10.4), 3));
  // Whole-less signals begin inside the asked range and never invent a shell.
  expect(sky({ ...single({ ...carry, start: 10.2 }, 10.4), from: 10.2 }).shells).toHaveLength(0);
});

it('matches the card burst widths at Stage A and keeps Stage B bursts readable', () => {
  for (const [width, height] of [
    [1300, 760],
    [1299, 674.5],
    [560, 674.5],
  ]) {
    const scene = sky({
      ...frame,
      width,
      height,
      instruments: frame.instruments.map((i) => ({ ...i, inSection: false })),
    });
    expect(scene.pads).toHaveLength(6);
    for (const [midi, sound, start, cardWidth] of [
      [27, undefined, 10, 250],
      [39, undefined, 10, 220],
      [undefined, 'bd', 10, 200],
      [undefined, 'hh', 10.375, 84],
      [undefined, 'oh', 10.25, 120],
    ] as const) {
      const shell = scene.shells.find(
        (s) =>
          s.event.note.start === start &&
          (midi !== undefined ? s.event.midi === midi : s.event.note.value.s === sound),
      )!;
      expect(shell).toBeDefined();
      const points = Array.from({ length: 22 }, (_, i) => shellSpark(shell, i));
      const span =
        Math.min(width, Math.max(...points.map((p) => p.x))) -
        Math.max(0, Math.min(...points.map((p) => p.x)));
      expect(span).toBeGreaterThanOrEqual((cardWidth * width) / 960);
      if (width === 560) expect(span).toBeGreaterThanOrEqual(sound === 'hh' ? 48 : 64);
    }
    const tops = scene.shells.flatMap((s) =>
      s.age < 0 ? [s.y - 3] : Array.from({ length: 22 }, (_, i) => shellSpark(s, i).y),
    );
    const caption = Math.max(22, (24 * width) / 960) + 35;
    expect(Math.min(...tops) - caption).toBeLessThanOrEqual(height / 4);
  }
});
