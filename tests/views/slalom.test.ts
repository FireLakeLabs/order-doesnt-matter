import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  corridorOffset,
  gateBundles,
  indexSlalom,
  pitchX,
  readPitch,
  routeAt,
  slalomLayout,
  slalomState,
} from '../../src/views/slalom/model';
import { accidentalStyle, spell } from '../../src/views/chord-bridge/drawing';
import type { ViewFrame } from '../../src/views/types';
let real: ViewFrame;
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  real = scoreFrame(state.rows.length);
  real.now = 17.4;
  real.sections = state.sections.map((s) => ({
    name: s.name,
    from: s.start,
    to: s.start + s.cycles,
  }));
  const entries = await Promise.all(
    state.rows.map(
      async (row) =>
        [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 12, 28)] as const,
    ),
  );
  entries.forEach(([, r]) => expect(r.error).toBeNull());
  real.from = 12;
  real.to = 28;
  real.lookAhead = 2;
  real.notes = viewNotes({ from: 12, to: 28, events: Object.fromEntries(entries) });
  real.instruments.forEach((i, n) => {
    i.id = state.rows[n].id;
    i.name = state.rows[n].name;
  });
});
it('uses the real breakdown: passed G4 and E♭4; D4 is next, with the pad terrain and vocal flag', () => {
  const score = indexSlalom(real),
    s = slalomState(score, real);
  expect(real.instruments.find((i) => i.id === score.melody)?.name).toMatch(/triangle$/);
  expect(real.instruments.find((i) => i.id === score.terrain)?.name).toMatch(/darkPad$/);
  expect(s.passed.map((g) => [g.start, g.label])).toEqual([
    [17, 'G4'],
    [17.25, 'E♭4'],
  ]);
  expect(s.next).toMatchObject({ start: 17.5, label: 'D4' });
  expect(
    score.notes.filter((n) => n.start <= 17.4 && n.end > 17.4 && n.instrument === score.terrain),
  ).toHaveLength(3);
  const vocal = real.instruments.find((i) => i.name === 'vocalAtmos')!;
  expect(
    score.notes.filter((n) => n.instrument === vocal.id && n.start <= 17.4 && n.end > 17.4),
  ).toHaveLength(1);
  const renamed = {
    ...real,
    instruments: real.instruments.map((i) => ({ ...i, name: 'renamed' })).reverse(),
  };
  expect(indexSlalom(renamed)).toEqual(score);
  const style = accidentalStyle(
    score.notes.flatMap((n) => {
      const midi = readPitch(n);
      return midi === undefined ? [] : [midi];
    }),
  );
  expect(spell(63, style)).toBe('E♭4');
});
it('hits every real gate at onset and is smooth from both sides, including adjacent notes', () => {
  for (const frame of [
    real,
    {
      ...real,
      notes: [0, 1, 2].map((start) => ({
        instrument: 'x',
        start,
        end: start + 1,
        hasOnset: true,
        value: { note: 60 + start * 7 },
      })),
      sections: [],
      from: 0,
      to: 3,
    },
  ]) {
    const score = indexSlalom(frame);
    for (const g of score.gates) {
      expect(routeAt(score.gates, g.start)).toBe(g.x);
      expect(Math.abs(routeAt(score.gates, g.start - 1e-6) - g.x)).toBeLessThan(1e-5);
      expect(Math.abs(routeAt(score.gates, g.start + 1e-6) - g.x)).toBeLessThan(1e-5);
    }
  }
});
it('counts 500 colliding gate notes, keeps all roles and counts a simultaneous chord as a bundle', () => {
  const f = scoreFrame(20);
  f.now = 0.4;
  f.from = 0;
  f.to = 2;
  f.lookAhead = 1;
  f.notes = Array.from({ length: 500 }, (_, i) => ({
    instrument: '0',
    start: i / 500,
    end: (i + 1) / 500,
    hasOnset: true,
    value: { note: 60 + (i % 12) },
  }));
  const score = indexSlalom(f),
    box = slalomLayout(f),
    bundles = gateBundles(score, box);
  expect(score.gates.reduce((n, g) => n + g.notes.length, 0)).toBe(500);
  expect(bundles.reduce((n, b) => n + b.count, 0)).toBe(
    score.gates.filter((g) => g.start < box.to && g.end > box.from).length,
  );
  expect(bundles.some((b) => b.count > 1)).toBe(true);
  const chord = indexSlalom({
    ...f,
    notes: f.notes.slice(0, 3).map((n) => ({ ...n, start: 0, end: 1 })),
  });
  expect(chord.gates).toHaveLength(1);
  expect(chord.gates[0].notes).toHaveLength(3);
  expect(routeAt(chord.gates, 0)).toBe(chord.gates[0].x);
  const unisons = indexSlalom({
    ...f,
    notes: chord.gates[0].notes.map((n) => ({ ...n, value: { note: 60 } })),
  });
  expect(unisons.gates[0].notes).toHaveLength(3);
  expect(gateBundles(unisons, box)[0].count).toBe(3);
  const carries = indexSlalom({
    ...f,
    notes: unisons.gates[0].notes.map((n) => ({ ...n, hasOnset: false })),
  });
  expect(carries.gates[0].notes).toHaveLength(3);
  const manyFrame = {
    ...f,
    notes: f.notes.map((n, i) => ({
      ...n,
      instrument: String(i % 20),
      value: { note: 40 + (i % 20) },
    })),
  };
  const many = indexSlalom(manyFrame),
    visible = slalomState(many, manyFrame);
  expect(new Set(many.notes.map((n) => n.instrument)).size).toBe(20);
  expect(many.melody).toBe('19');
  expect(many.terrain).toBe('0');
  expect(many.gates.flatMap((g) => g.notes)).toHaveLength(25);
  expect(visible.gates.length + visible.sides.length).toBe(
    many.notes.filter((n) => n.start < visible.box.to && n.end > visible.box.from).length,
  );
});
it('keeps fixed pitch positions and deduplicates query continuations without losing genuine unisons', () => {
  const score = indexSlalom(real);
  const duplicated = indexSlalom({
    ...real,
    notes: [...real.notes, ...real.notes.map((n) => ({ ...n, hasOnset: false }))],
  });
  expect(duplicated).toEqual(score);
  const g = score.gates.find((g) => g.start === 17.25)!;
  const reduced = indexSlalom({ ...real, notes: real.notes.filter((n) => n.start === 17.25) });
  expect(reduced.gates[0].x).toBe(g.x);
  expect(g.x).toBe(pitchX(63));
  expect(indexSlalom({ ...real, notes: [] }).gates).toEqual([]);
  expect(routeAt([], 0)).toBe(0.5);
  const drum = indexSlalom({
    ...real,
    notes: [{ instrument: 'drum', start: 17, end: 18, hasOnset: true, value: { s: 'bd', n: 36 } }],
  });
  expect(drum.melody).toBeUndefined();
  expect(slalomState(drum, real).sides).toHaveLength(1);
});

it('keeps a touching held-note corridor around the skier throughout its span', () => {
  const frame = scoreFrame();
  frame.from = 0;
  frame.to = 4;
  frame.now = 1.8;
  frame.notes = [
    { instrument: '0', start: 0, end: 2, hasOnset: true, value: { note: 48 } },
    { instrument: '0', start: 2, end: 4, hasOnset: true, value: { note: 76 } },
  ];
  const score = indexSlalom(frame),
    held = score.gates[0];
  expect(corridorOffset(score.gates, held, held.start)).toBe(0);
  expect(corridorOffset(score.gates, held, 1.8)).toBeGreaterThan(0.1);
  for (const time of [0, 0.5, 1, 1.5, 1.8, 2]) {
    const offset = corridorOffset(score.gates, held, time),
      skier = routeAt(score.gates, time);
    expect(skier).toBeGreaterThanOrEqual(held.low + offset - 1e-12);
    expect(skier).toBeLessThanOrEqual(held.high + offset + 1e-12);
  }
});
