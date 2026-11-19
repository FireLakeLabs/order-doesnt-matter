import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, viewNotes } from '../../src/studio/frame';
import type { ViewFrame, ViewNote } from '../../src/views/types';
import {
  indexRig,
  partAt,
  rigLook,
  rigSlots,
  scoredPitch,
  slotAt,
  spread,
} from '../../src/views/light-rig/model';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import { themes, viewTheme } from '../../src/studio/themes';

let real: ViewFrame;
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  const entries = await Promise.all(
    state.rows.map(
      async (row) =>
        [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 4, 22)] as const,
    ),
  );
  for (const [, r] of entries) expect(r.error).toBeNull();
  const score = { from: 4, to: 22, events: Object.fromEntries(entries) };
  real = buildFrame({
    ...scoreFrame(),
    state,
    score,
    notes: viewNotes(score),
    lookAhead: 6,
    playing: false,
  });
});
const note = (
  instrument = '0',
  start = 0,
  end = 1,
  value: ViewNote['value'] = { note: 48, gain: 1 },
): ViewNote => ({ instrument, start, end, value, hasOnset: true });
it('derives real roles from notes, preserves all six drop assignments and reports the exact check moment', () => {
  const score = indexRig(real),
    slots = rigSlots(real, score);
  expect(slots.reduce((n, s) => n + s.members.length, 0)).toBe(6);
  expect(slots.find((s) => s.role === 'wash')!.members[0].name).toBe('subBass');
  expect(slots.find((s) => s.role === 'strobe')!.members[0].name).toBe('bd');
  const states = slots.map((s) => ({
    role: s.role,
    names: s.members.map((i) => i.name),
    ...slotAt(s, score, real),
  }));
  console.log(
    'Light rig bar 11 at 40%:',
    JSON.stringify(
      states.map(({ role, names, active, flashing, held }) => ({
        role,
        names,
        active,
        flashing,
        held,
      })),
    ),
  );
  const renamed = {
    ...real,
    instruments: real.instruments.map((i) => ({ ...i, name: 'not a clue' })),
  };
  expect(
    rigSlots(renamed, indexRig(renamed)).map((s) => [s.role, s.members.map((i) => i.id)]),
  ).toEqual(slots.map((s) => [s.role, s.members.map((i) => i.id)]));
  expect(states.reduce((n, s) => n + s.active, 0)).toBe(3);
});
it('holds exactly [start,end), flashes only onsets for 35 ms, and maps gain to brightness', () => {
  const frame = { ...scoreFrame(), notes: [note()] };
  const p = indexRig(frame).parts.get('0')!;
  expect(partAt(p, -0.001, 1, 'heads').active).toBe(0);
  expect(partAt(p, 0, 1, 'heads')).toMatchObject({ active: 1, flashing: 1, held: 0 });
  expect(partAt(p, 0.035, 1, 'heads')).toMatchObject({ active: 1, flashing: 0, held: 1 });
  expect(partAt(p, 0.999, 1, 'heads').brightness).toBeGreaterThan(0);
  expect(partAt(p, 1, 1, 'heads').brightness).toBe(0);
  const quiet = indexRig({ ...frame, notes: [note('0', 0, 1, { note: 48, gain: 0.5 })] }).parts.get(
    '0',
  )!;
  expect(partAt(p, 0.5, 1, 'heads').brightness).toBe(2 * partAt(quiet, 0.5, 1, 'heads').brightness);
  const fragment = indexRig({ ...frame, notes: [{ ...note(), hasOnset: false }] }).parts.get('0')!;
  expect(partAt(fragment, 0, 1, 'heads')).toMatchObject({ active: 1, flashing: 0, held: 1 });
});
it('bounds dense strobes locally and still counts every one of 500 genuine notes', () => {
  const notes = Array.from({ length: 500 }, (_, i) =>
    note('0', i / 500, (i + 1) / 500, { gain: 4 }),
  );
  const score = indexRig({ ...scoreFrame(), notes }),
    p = score.parts.get('0')!;
  expect(p.notes).toHaveLength(500);
  let lit = 0;
  for (let i = 0; i < 1000; i++) {
    const state = partAt(p, i / 1000, 1, 'strobe');
    expect(state.brightness).toBeLessThanOrEqual(0.24);
    if (state.brightness) lit++;
  }
  expect(lit).toBeLessThan(30);
  expect(partAt(p, 0.1, 1, 'strobe').active).toBe(1);
  expect(partAt(p, 0.5, 1, 'strobe').merged).toBe(91);
});
it('never invents sample-bank pitch and uses absolute higher pitches for wider aims', () => {
  const instrument = scoreFrame().instruments[0];
  expect(scoredPitch(note('0', 0, 1, { n: 3, s: 'speech' }), instrument)).toBeUndefined();
  expect(
    scoredPitch(note('0', 0, 1, { n: 36 }), {
      ...instrument,
      settings: [{ name: 'n', kind: 'values', label: 'Notes' }],
    }),
  ).toBe(36);
  expect(spread(84)).toBeGreaterThan(spread(36));
});
it('eases from the preceding aim continuously, and a sibling ending cannot move a held beam', () => {
  const frame = {
    ...scoreFrame(),
    notes: [note('0', 0, 2, { note: 36 }), note('0', 1, 1.05, { note: 84 })],
  };
  const p = indexRig(frame).parts.get('0')!;
  expect(partAt(p, 1 - 1e-8, 1, 'heads').aim).toBeCloseTo(partAt(p, 1, 1, 'heads').aim, 6);
  expect(partAt(p, 1.12, 1, 'heads').aim).toBe(spread(84));
  expect(partAt(p, 1.9, 1, 'heads').aim).toBe(spread(84));
  const original = partAt(p, 1.04, 1, 'heads');
  for (const now of [20, 0, -1, 1.8]) partAt(p, now, 1, 'heads');
  expect(partAt(p, 1.04, 1, 'heads')).toEqual(original);
});
it('shares a maximum of eight assignments across twenty parts, counts every overlap and respects mute', () => {
  const frame = scoreFrame(20);
  frame.sections = [];
  frame.now = 0.5;
  frame.notes = frame.instruments.flatMap((i) => [
    note(i.id, 0, 1, { note: 36 + i.index }),
    note(i.id, 0, 0.25, { note: 60 }),
  ]);
  const score = indexRig(frame),
    slots = rigSlots(frame, score);
  expect(slots).toHaveLength(8);
  expect(slots.reduce((n, s) => n + s.members.length, 0)).toBe(20);
  expect(slots.map((s) => slotAt(s, score, frame)).reduce((n, s) => n + s.active, 0)).toBe(20);
  const shared = slots.find((s) => s.members.length > 1)!;
  const a = slotAt(shared, score, { ...frame, now: 0.24999 }),
    b = slotAt(shared, score, { ...frame, now: 0.25001 });
  expect(a.aim).toBe(b.aim);
  expect(a.leader.instrument.id).toBe(b.leader.instrument.id);
  const muted = { ...shared, members: shared.members.map((i) => ({ ...i, muted: true })) };
  expect(slotAt(muted, score, frame)).toMatchObject({ active: 0, brightness: 0 });
});
it('switches palette and positions by score section, including wrapped song time', () => {
  expect(rigLook({ ...real, now: 7.99 }).index).not.toBe(rigLook({ ...real, now: 8 }).index);
  expect(rigLook({ ...real, now: 10.4 }).index).toBe(rigLook({ ...real, now: 38.4 }).index);
  const single = { ...scoreFrame(), notes: [note()] };
  expect(rigSlots(single, indexRig(single))).toHaveLength(1);
});
it.each(Object.values(themes))(
  '$name labels have 4.5:1 contrast on the opaque ground plate',
  (theme) => {
    const t = viewTheme(theme);
    const luminance = (hex: string) =>
      hex
        .slice(1)
        .match(/../g)!
        .map((v) => parseInt(v, 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const [lo, hi] = [luminance(t.ground), luminance(t.text)].sort((a, b) => a - b);
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
  },
);

it('coalesces query carry-ins independently of input order while preserving genuine coincident onsets', () => {
  const onset = note('0', 0, 8),
    carry = { ...onset, hasOnset: false };
  for (const notes of [
    [onset, carry, carry],
    [carry, carry, onset],
  ]) {
    const p = indexRig({ ...scoreFrame(), notes }).parts.get('0')!;
    expect(p.notes).toHaveLength(1);
    expect(partAt(p, 6, 1, 'heads')).toMatchObject({ active: 1, held: 1 });
  }
  const p = indexRig({ ...scoreFrame(), notes: [onset, onset] }).parts.get('0')!;
  expect(p.notes).toHaveLength(2);
  expect(partAt(p, 0.035, 1, 'strobe').brightness).toBe(0);
});
