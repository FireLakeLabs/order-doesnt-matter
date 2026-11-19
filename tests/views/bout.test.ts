import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  boutLayout,
  boutState,
  fighterAt,
  gesture,
  indexBout,
  rankFighters,
} from '../../src/views/bout/model';
import type { ViewFrame, ViewNote } from '../../src/views/types';

let dubstep: ViewFrame;
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  dubstep = scoreFrame(state.rows.length);
  dubstep.from = 4;
  dubstep.to = 20;
  dubstep.lookAhead = 1;
  dubstep.sections = state.sections.map((s) => ({
    name: s.name,
    from: s.start,
    to: s.start + s.cycles,
  }));
  const entries = await Promise.all(
    state.rows.map(
      async (row) =>
        [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 4, 20)] as const,
    ),
  );
  for (const [, result] of entries) expect(result.error).toBeNull();
  dubstep.notes = viewNotes({ from: 4, to: 20, events: Object.fromEntries(entries) });
  dubstep.instruments.forEach((i, n) => {
    i.id = state.rows[n].id;
    i.name = state.rows[n].name;
  });
});
const note = (
  id: string,
  start: number,
  end = start + 0.125,
  value: ViewNote['value'] = {},
): ViewNote => ({ instrument: id, start, end, hasOnset: true, value });
it('the real check moment has 8 hats jabs, 2 open-hat steps, four arena parts and two held bass lamps', () => {
  const score = indexBout(dubstep.notes),
    s = boutState(score, dubstep);
  expect(s.fighters.map((f) => f.count)).toEqual([8, 2]);
  expect(s.total).toBe(14);
  const fighters = s.fighters.map((f) => ({
    name: f.part.name,
    move: score.moves.get(f.part.id),
    pose: fighterAt(score, f.part.id, 10.4),
  }));
  expect(fighters[0].move).toBe('jab');
  expect(fighters[0].pose.lead!.note.start).toBe(10.375);
  expect(fighters[0].pose.label).toBe('jab');
  expect(fighters[1].move).toBe('guard');
  expect(fighters[1].pose.lead!.note.start).toBe(10.25);
  expect(fighters[1].pose.label).toBe('step / guard');
  expect(s.arena).toHaveLength(4);
  expect(s.arena.map((a) => score.moves.get(a.part.id))).toEqual([
    'heavy',
    'heavy',
    'bass blow',
    'bass blow',
  ]);
  expect(s.arena.flatMap((a) => a.holds)).toHaveLength(2);
  expect(s.arena.flatMap((a) => a.progress)).toEqual([expect.closeTo(0.4), expect.closeTo(0.4)]);
  expect(s.round).toBe(3);
  console.log(
    'Bout check moment',
    JSON.stringify({
      fighters: fighters.map((f) => ({
        name: f.name,
        move: f.move,
        pose: f.pose.label,
        onset: f.pose.lead!.note.start,
      })),
      arena: s.arena.map((a) => ({
        name: a.part.name,
        notes: a.notes.length,
        holds: a.holds.length,
        progress: a.progress,
      })),
    }),
  );
});
it('ranks all onsets in the selected window with row-order ties, independent of names, samples, mute and input order', () => {
  const f = scoreFrame(3);
  f.now = 0.4;
  f.lookAhead = 1;
  f.notes = [note('2', 0), note('1', 0), note('0', 0), note('2', 0.5)];
  const s = indexBout(f.notes);
  expect(rankFighters(s, f, 0).map((r) => r.part.id)).toEqual(['2', '0']);
  const changed = {
    ...f,
    instruments: f.instruments.map((i) => ({ ...i, name: 'bd bass hh', muted: true })).reverse(),
  };
  expect(rankFighters(s, changed, 0).map((r) => r.part.id)).toEqual(['2', '0']);
  const renamed = indexBout(
    f.notes.map((n) => ({ ...n, value: { ...n.value, s: 'anything', n: 83 } })).reverse(),
  );
  expect(renamed.moves).toEqual(s.moves);
  f.lookAhead = 2;
  f.notes.push(...Array.from({ length: 5 }, () => note('1', 1)));
  expect(rankFighters(indexBout(f.notes), f, 0)[0].part.id).toBe('1');
});
it('winds up before the onset, extends exactly there and recovers, independent of visit order', () => {
  const n = note('0', 1);
  expect(gesture(n, 'jab', 0.97).extension).toBeLessThan(0);
  expect(gesture(n, 'jab', 1).extension).toBe(1);
  expect(gesture(n, 'jab', 1.08).extension).toBeLessThan(1);
  const s = indexBout([n]),
    before = fighterAt(s, '0', 1.025);
  fighterAt(s, '0', 4);
  fighterAt(s, '0', 0);
  expect(fighterAt(s, '0', 1.025)).toEqual(before);
});
it('charges for exactly a held span and releases at its end, including a carried note', () => {
  const n = { ...note('0', 1, 2, { note: 'c1' }), hasOnset: false };
  expect(gesture(n, 'heavy', 0.99).active).toBe(false);
  expect(gesture(n, 'heavy', 1).charging).toBe(true);
  expect(gesture(n, 'heavy', 1.5).charge).toBe(0.5);
  expect(gesture(n, 'heavy', 1.999).charging).toBe(true);
  expect(gesture(n, 'heavy', 2)).toMatchObject({ charging: false, extension: 1, move: 'special' });
  expect(gesture(n, 'heavy', 2.24).active).toBe(false);
});
it('counts crowded moves, coincident clashes, carries and every arena note without adding duplicate fragments', () => {
  const f = scoreFrame(20);
  f.now = 0.4;
  f.lookAhead = 1;
  f.notes = [
    ...Array.from({ length: 500 }, () => note('0', 0.375)),
    ...Array.from({ length: 400 }, () => note('1', 0.375)),
    ...Array.from({ length: 18 }, (_, i) => note(String(i + 2), 0, 1, { note: 30 + i })),
  ];
  const carry = { ...f.notes.at(-1)!, hasOnset: false };
  f.notes.push(carry);
  const s = indexBout(f.notes),
    state = boutState(s, f);
  expect(state.total).toBe(918);
  expect(state.clashes).toEqual([{ time: 0.375, count: 900 }]);
  expect(fighterAt(s, '0', f.now).count).toBe(500);
  expect(fighterAt(s, '1', f.now).count).toBe(400);
  expect(state.arena.flatMap((a) => a.holds)).toHaveLength(18);
  expect(
    state.arena.reduce((n, a) => n + a.notes.length, 0) +
      state.fighters.reduce((n, a) => n + a.count, 0),
  ).toBe(state.total);
});
it('tag-ins derive from the preceding window, including departures, and backwards seeks match', () => {
  const f = scoreFrame(3);
  f.lookAhead = 1;
  f.notes = [note('0', 0), note('1', 0), note('2', 1), note('2', 1.5), note('1', 1)];
  const score = indexBout(f.notes);
  f.now = 1.1;
  const s = boutState(score, f);
  expect(s.fighters.map((r) => r.part.id)).toEqual(['2', '1']);
  expect(s.previous.map((r) => r.part.id)).toEqual(['0', '1']);
  expect(s.departures.map((r) => r.part.id)).toEqual(['0']);
  expect(s.tag).toBeCloseTo(1 / 3);
  boutState(score, { ...f, now: 0.2 });
  expect(boutState(score, f)).toEqual(s);
});
it('keeps arena holds even with no onsets and lays out legible large and narrow figures', () => {
  const f = scoreFrame(1);
  f.now = 1.4;
  f.lookAhead = 1;
  f.notes = [{ ...note('0', 0, 3), hasOnset: false }];
  const s = boutState(indexBout(f.notes), f);
  expect(s.fighters).toHaveLength(0);
  expect(s.arena[0].holds).toHaveLength(1);
  expect(s.total).toBe(1);
  for (const [w, h] of [
    [1300, 760],
    [1131, 469],
    [559, 675],
  ]) {
    const b = boutLayout(w, h);
    expect(b.feet - 245 * b.scale).toBeGreaterThanOrEqual(100);
    expect(b.feet + 44).toBeLessThan(h - b.footer);
    expect(b.scale * 245).toBeGreaterThan(150);
  }
});

it('honours the four-cycle window and section ordinals on later repeated sections', () => {
  const score = indexBout(dubstep.notes);
  const state = boutState(score, { ...dubstep, lookAhead: 4 });
  expect(state.fighters.map((f) => f.count)).toEqual([32, 8]);
  expect(state.total).toBe(58);
  expect(boutState(score, { ...dubstep, now: 22.4 }).round).toBe(5);
  expect(boutState(score, { ...dubstep, now: 38.4 }).round).toBe(3);
});

it('does not invent a strike or wind-up at a short continuation boundary', () => {
  const carry = { ...note('0', 1), hasOnset: false };
  for (const now of [0.97, 1, 1.05]) expect(gesture(carry, 'jab', now).active).toBe(false);
});

it('selects by onsets but gives carried notes their share in a fighter’s energy bar', () => {
  const frame = scoreFrame(3);
  frame.now = 1.4;
  frame.lookAhead = 1;
  frame.notes = [
    note('0', 1),
    note('1', 1),
    { ...note('1', 0, 3), hasOnset: false },
    note('2', 1.5),
  ];
  const state = boutState(indexBout(frame.notes), frame);
  expect(state.fighters.map((f) => f.part.id)).toEqual(['0', '1']);
  expect(state.fighters.map((f) => f.count)).toEqual([1, 1]);
  expect(state.fighters.map((f) => f.noteCount)).toEqual([1, 2]);
  expect(state.total).toBe(4);
});
