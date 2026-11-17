import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import type { ViewFrame } from '../../src/views/types';
import {
  enemies,
  enemyPose,
  enemySize,
  formation,
  hitCount,
  isCarrier,
  wave,
} from '../../src/views/swarm/model';

let frame: ViewFrame;
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  const entries = await Promise.all(
    state.rows.map(
      async (row) =>
        [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 0, 28)] as const,
    ),
  );
  for (const [, result] of entries) expect(result.error).toBeNull();
  frame = {
    ...scoreFrame(state.rows.length),
    notes: viewNotes({ from: 0, to: 28, events: Object.fromEntries(entries) }),
    sections: state.sections.map((s) => ({ name: s.name, from: s.start, to: s.start + s.cycles })),
  };
  frame.instruments.forEach((i, index) => {
    i.id = state.rows[index].id;
    i.name = state.rows[index].name;
    i.inSection = state.rows[index].uses.some((u) =>
      u.path.some((n) => n.id === state.sections[2].id),
    );
  });
});
it('places real drop notes at proportional columns and one row per participating instrument', () => {
  const g = formation(frame);
  expect(g.rows).toHaveLength(6);
  expect(new Set(g.rows.map((r) => r.y)).size).toBe(6);
  for (const row of g.rows)
    for (const n of row.notes) {
      expect(n.instrument).toBe(row.instrument.id);
      expect(g.x(n.start)).toBeCloseTo(g.left + Math.max(0, n.start - 10) * (g.right - g.left));
    }
  expect(g.shipX).toBeCloseTo(g.left + 0.4 * (g.right - g.left));
  expect(
    formation({
      ...frame,
      instruments: frame.instruments.map((i) => ({ ...i, name: 'renamed' })),
    }).rows.map((r) => r.notes),
  ).toEqual(g.rows.map((r) => r.notes));
});
it('dives exactly in the last eighth, is hit on onset, and reverses without history', () => {
  const n = frame.notes.find((n) => n.start === 10.5 && !isCarrier(n))!;
  expect(n).toBeDefined();
  const pose = (now: number) => enemyPose(n, now, 500, 200, 600);
  expect(pose(10.375).diving).toBe(false);
  expect(pose(10.4).diving).toBe(true);
  expect(pose(10.499999).y).toBeCloseTo(600, 2);
  expect(pose(10.499999).hit).toBe(false);
  expect(pose(10.5).hit).toBe(true);
  const saved = pose(10.4);
  pose(20);
  pose(0);
  expect(pose(10.4)).toEqual(saved);
});
it('real held bass carriers burn over their exact scored spans and gain sets size', () => {
  const n = frame.notes.find((n) => n.start === 10 && n.end === 11 && n.value.note !== undefined)!;
  expect(n).toBeDefined();
  expect(isCarrier(n)).toBe(true);
  const pose = (now: number) => enemyPose(n, now, 0, 0, 1);
  expect(pose(10).remaining).toBe(1);
  expect(pose(10.4).remaining).toBeCloseTo(0.6);
  expect(pose(11).remaining).toBe(0);
  expect(enemySize({ ...n, value: { gain: 0.4 } })).toBeLessThan(
    enemySize({ ...n, value: { gain: 1 } }),
  );
  expect(enemySize({ ...n, value: { gain: Infinity } })).toBe(enemySize({ ...n, value: {} }));
  const fragment = { ...n, hasOnset: false };
  expect(isCarrier(fragment)).toBe(true);
  expect(enemyPose(fragment, 10.4, 0, 0, 1).hit).toBe(false);
});
it('counts bar onsets inclusively, independent of cache window, fragments and order of travel', () => {
  const expected = frame.notes.filter((n) => n.hasOnset && n.start >= 10 && n.start <= 10.4).length;
  expect(expected).toBe(8);
  expect(hitCount(frame)).toBe(expected);
  expect(hitCount({ ...frame, notes: frame.notes.filter((n) => n.end > 8 && n.start < 20) })).toBe(
    expected,
  );
  hitCount({ ...frame, now: 0 });
  hitCount({ ...frame, now: 25 });
  expect(hitCount(frame)).toBe(expected);
  expect(hitCount({ ...frame, notes: frame.notes.map((n) => ({ ...n, hasOnset: false })) })).toBe(
    0,
  );
  expect(
    hitCount({ ...frame, instruments: frame.instruments.map((i) => ({ ...i, muted: true })) }),
  ).toBe(0);
  expect(wave(frame)).toEqual({ number: 3, name: frame.sections[2].name });
  expect(wave({ ...frame, now: 38.4 })).toEqual(wave(frame));
  expect(wave({ now: 99, sections: [] })).toEqual({ number: 1, name: 'Open space' });
});
it('warps in the actual next bar instead of assuming a repeat', () => {
  const f = { ...frame, now: 3.4 };
  const next = formation(f).rows.flatMap((r) => r.next);
  expect(next).toEqual(
    expect.arrayContaining(frame.notes.filter((n) => n.start >= 4 && n.start < 5)),
  );
  expect(next.every((n) => n.start >= 4 && n.start < 5)).toBe(true);
});
it('retains all 500 corpus-derived notes in shielded rows at one and twenty instruments', () => {
  const source = frame.notes.find((n) => !isCarrier(n))!;
  for (const count of [1, 20]) {
    const f = scoreFrame(count);
    f.now = 0.4;
    f.notes = Array.from({ length: 500 }, (_, i) => ({
      ...source,
      instrument: String(i % count),
      start: i / 500,
      end: i / 500 + 0.001,
    }));
    for (const width of [560, 1300]) {
      const g = formation({ ...f, width });
      expect(g.rows).toHaveLength(count);
      expect(g.rows.reduce((sum, r) => sum + r.notes.length, 0)).toBe(500);
      expect(g.rows.every((r) => r.crowded)).toBe(true);
    }
    expect(hitCount(f)).toBe(201);
  }
  expect(formation({ ...scoreFrame(1), notes: [] }).rows).toHaveLength(1);
});

it('names waves at section boundaries and later song passes', () => {
  expect(wave(frame)).toEqual({ number: 3, name: 'drop' });
  expect(wave({ ...frame, now: 16 })).toEqual({ number: 4, name: 'breakdown' });
  expect(wave({ ...frame, now: 38.4 })).toEqual(wave(frame));
  expect(wave({ ...frame, sections: [] }).name).toBe('Open space');
});
it('warps actual next-bar slots rather than repeating played notes', () => {
  const g = formation({ ...frame, now: 15.4 });
  const next = g.rows.flatMap((r) => r.next);
  expect(next.length).toBeGreaterThan(0);
  expect(next.every((n) => n.start >= 16 && n.start < 17)).toBe(true);
  expect(new Set(next.map((n) => n.instrument))).not.toEqual(
    new Set(g.rows.flatMap((r) => r.notes).map((n) => n.instrument)),
  );
});
it('retains all 500 notes with one or twenty instruments as counted shield occupancy', () => {
  const base = frame.notes.find((n) => n.start === 10 && !isCarrier(n))!;
  for (const count of [1, 20]) {
    const dense = {
      ...scoreFrame(count),
      now: 0.4,
      notes: Array.from({ length: 500 }, (_, i) => ({
        ...base,
        instrument: String(i % count),
        start: i / 500,
        end: (i + 1) / 500,
      })),
    };
    const g = formation(dense);
    expect(g.rows).toHaveLength(count);
    expect(g.rows.every((r) => r.crowded)).toBe(true);
    expect(g.rows.reduce((n, r) => n + r.notes.length, 0)).toBe(500);
    expect(hitCount({ ...dense, now: 0.999 })).toBe(500);
    expect(new Set(g.rows.map((r) => r.y)).size).toBe(count);
  }
  expect(formation({ ...frame, notes: [], instruments: [] }).rows).toEqual([]);
});

it('setting fragments continue real bass carriers without inventing enemies or crowding', () => {
  const g = formation(frame);
  const bass = g.rows.filter((r) => r.enemies.some((n) => n.start === 10 && n.end === 11));
  expect(bass).toHaveLength(2);
  for (const row of bass) {
    expect(row.enemies).toHaveLength(1);
    expect(row.crowded).toBe(false);
  }
  const n = bass[0].enemies[0];
  const unison = formation({ ...frame, notes: [n, { ...n }] }).rows.find(
    (r) => r.instrument.id === n.instrument,
  )!;
  expect(unison.enemies).toHaveLength(2);
  expect(unison.crowded).toBe(true);
});

it('fragment-only chords preserve distinct pitches as separate carriers', () => {
  const n = frame.notes.find((n) => n.start === 10 && n.end === 11)!;
  const chord = [60, 64, 67].map((pitch) => ({ ...n, hasOnset: false, value: { note: pitch } }));
  expect(enemies(chord)).toHaveLength(3);
  expect(enemies([...chord, { ...chord[0], value: { note: 60, lpf: 400 } }])).toHaveLength(3);
});
