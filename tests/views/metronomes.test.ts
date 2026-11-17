import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { analyse, EXTREME, inStep, layout, poses, swing } from '../../src/views/metronomes/model';
import { scoreFrame } from './score-fixture';
import type { ViewFrame, ViewNote } from '../../src/views/types';

let real: ViewFrame;
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  const entries = await Promise.all(
    state.rows.map(
      async (row) =>
        [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 4, 20)] as const,
    ),
  );
  for (const [, result] of entries) expect(result.error).toBeNull();
  const score = { from: 4, to: 20, events: Object.fromEntries(entries) };
  real = buildFrame({ ...scoreFrame(), state, score, notes: viewNotes(score) });
});
const note = (start: number, end: number, hasOnset = true): ViewNote => ({
  instrument: '0',
  start,
  end,
  hasOnset,
  value: {},
});

it('alternates extremes on every distinct onset and eases between real irregular times', () => {
  const p = analyse([note(0, 0.1), note(0.25, 0.3), note(0.9, 1), note(0.25, 0.4)]).get('0')!;
  expect(p.onsets).toHaveLength(3);
  expect(swing(p, 0)).toBe(-EXTREME);
  expect(swing(p, 0.25)).toBe(EXTREME);
  expect(swing(p, 0.9)).toBe(-EXTREME);
  expect(swing(p, 0.125)).toBeCloseTo(0);
  expect(swing(p, 0.575)).toBeCloseTo(0);
  expect(Math.abs(swing(p, 0.025) + EXTREME)).toBeLessThan(EXTREME * 0.1);
});
it('keeps regular odd-density trains in phase when the host window advances', () => {
  const notes = Array.from({ length: 60 }, (_, i) => note(i / 3, (i + 1) / 3));
  const full = analyse(notes).get('0')!;
  const windowed = analyse(notes.filter((n) => n.start >= 4 && n.start < 16)).get('0')!;
  for (const now of [8, 8.1, 8.5, 8.9]) expect(swing(windowed, now)).toBeCloseTo(swing(full, now));
});
it('holds the actual covered swing, includes fragments without inventing onsets, and parks silence', () => {
  const f = scoreFrame();
  f.now = 0.4;
  f.notes = [note(0, 0.5), note(0.25, 0.6, false), note(1, 1.1)];
  let p = poses(f, analyse(f.notes))[0];
  expect(p.part.onsets).toHaveLength(2);
  expect(p.lit?.[0]).toBe(-EXTREME);
  expect(p.lit?.[1]).toBeCloseTo(p.angle);
  expect(p.held).toBe(true);
  p = poses({ ...f, now: 0.6 }, analyse(f.notes))[0];
  expect(p.held).toBe(false);
  expect(p.lit).toBeUndefined();
  p = poses({ ...f, now: 2 }, analyse(f.notes))[0];
  expect(p.resting).toBe(true);
  expect(p.angle).toBe(0);
  const fragment = poses({ ...f, notes: [note(0, 2, false)] }, analyse([note(0, 2, false)]))[0];
  expect(fragment.held).toBe(true);
  expect(fragment.hits).toBe(0);
  expect(fragment.angle).toBe(0);
});
it('uses all 500 notes for density and occupancy, lowers the weight and switches at 33 hits', () => {
  const f = scoreFrame();
  f.now = 0.4;
  const pose = (count: number) => {
    f.notes = Array.from({ length: count }, (_, i) => note(i / count, (i + 1) / count));
    return poses(f, analyse(f.notes))[0];
  };
  const slow = pose(1),
    fast = pose(32),
    fan = pose(33),
    flood = pose(500);
  expect(slow.weight).toBeGreaterThan(fast.weight);
  expect(fast.fan).toBe(false);
  expect(fan.fan).toBe(true);
  expect(flood.hits).toBe(500);
  expect(flood.part.notes).toHaveLength(500);
  expect(flood.held).toBe(true);
  expect(Number.isFinite(flood.angle)).toBe(true);
});
it('centres a single part and places twenty in a five by four grid', () => {
  const single = layout(scoreFrame(), 1),
    twenty = layout(scoreFrame(), 20);
  expect(single.columns).toBe(1);
  expect(single.rows).toBe(1);
  expect(twenty.columns).toBe(5);
  expect(twenty.rows).toBe(4);
  expect(layout({ width: 560, height: 760 }, 6).rows).toBe(2);
});
it('finds the real drop lock from timing, keeps rests visible, and ignores names and playback flags', () => {
  const parts = analyse(real.notes),
    cast = poses(real, parts);
  const groups = inStep(cast).map((g) => g.map((p) => p.instrument.name));
  console.log(
    'Metronomes at 10.4:',
    JSON.stringify({
      groups,
      parts: cast.map((p) => ({
        name: p.instrument.name,
        hits: p.hits,
        angle: p.angle,
        resting: p.resting,
      })),
    }),
  );
  expect(
    groups.some(
      (g) => g.includes('subBass') && g.includes('wobbleBass') && g.some((n) => n.includes('bd')),
    ),
  ).toBe(true);
  const bass = cast.find((p) => p.instrument.name === 'subBass')!;
  const hats = cast.find((p) => p.instrument.name === 'hh · drop')!;
  expect(bass.held).toBe(true);
  expect(bass.lit?.[0]).toBe(-EXTREME);
  expect(bass.lit?.[1]).toBeCloseTo(bass.angle);
  expect(hats.hits).toBe(8);
  expect(bass.hits).toBe(1);
  expect(hats.weight).toBeLessThan(bass.weight);
  for (const p of cast.filter((p) => !p.resting)) {
    const onsets = p.part.onsets.filter((n) => n.start >= 10 && n.start < 11);
    for (const n of onsets) expect(Math.abs(swing(p.part, n.start))).toBeCloseTo(EXTREME);
    for (let i = 1; i < onsets.length; i++)
      expect(swing(p.part, onsets[i].start)).toBeCloseTo(-swing(p.part, onsets[i - 1].start));
  }
  expect(cast).toHaveLength(real.instruments.length);
  expect(cast.some((p) => p.resting)).toBe(true);
  const ids = inStep(cast).map((g) => g.map((p) => p.instrument.id));
  const renamed = poses(
    {
      ...real,
      playing: false,
      instruments: real.instruments.map((i) => ({ ...i, name: 'renamed', sounding: false })),
    },
    parts,
  );
  expect(inStep(renamed).map((g) => g.map((p) => p.instrument.id))).toEqual(ids);
  expect(renamed.map((p) => p.angle)).toEqual(cast.map((p) => p.angle));
  const before = poses(real, parts);
  poses({ ...real, now: 17 }, parts);
  poses({ ...real, now: 4.2 }, parts);
  expect(poses(real, parts)).toEqual(before);
});
it('does not label a passing polyrhythm crossing or muted part as locked', () => {
  const f = scoreFrame(3);
  f.now = 0.5;
  f.notes = [0, 1, 2].flatMap((id) =>
    Array.from({ length: id === 1 ? 3 : 2 }, (_, i) => ({
      ...note(i / (id === 1 ? 3 : 2), (i + 1) / (id === 1 ? 3 : 2)),
      instrument: String(id),
    })),
  );
  expect(inStep(poses(f, analyse(f.notes))).map((g) => g.map((p) => p.instrument.id))).toEqual([
    ['0', '2'],
  ]);
  f.instruments[2].muted = true;
  expect(inStep(poses(f, analyse(f.notes)))).toEqual([]);
});
