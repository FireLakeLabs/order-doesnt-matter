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
  breathing,
  diveDuration,
  drumPart,
  entryPoint,
  hitX,
  shipX,
  starPoint,
  spriteRadius,
  enemies,
  enemyPose,
  enemySize,
  formation,
  hitCount,
  isCarrier,
  playerWidth,
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
      expect(g.x(n.start)).toBeCloseTo(
        frame.width / 2 + ((n.start % 1) - 0.5) * (g.right - g.left) * breathing(frame),
      );
    }
  expect(g.right - g.left).toBeCloseTo(frame.width * 0.7);
  expect(g.rows[0].y).toBeCloseTo(frame.height * 0.15);
  expect(g.rows.at(-1)!.y).toBeCloseTo(frame.height * 0.45);
  expect(
    formation({
      ...frame,
      instruments: frame.instruments.map((i) => ({ ...i, name: 'renamed' })),
    }).rows.map((r) => r.notes),
  ).toEqual(g.rows.map((r) => r.notes));
});
it('curls before the onset, arrives exactly on it and reverses without history', () => {
  const n = frame.notes.find((n) => n.start === 10.5 && !isCarrier(n))!;
  const g = formation(frame);
  const pose = (now: number) => enemyPose(n, { ...frame, now }, 200, g.x);
  const duration = diveDuration(frame.cps);
  expect(pose(n.start - duration - 0.00001).diving).toBe(false);
  expect(pose(10.4).diving).toBe(true);
  expect(pose(10.499999).y).toBeCloseTo(frame.height * 0.76, 2);
  expect(pose(10.499999).x).toBeCloseTo(hitX(n.start, frame.width), 2);
  expect(pose(10.499999).hit).toBe(false);
  expect(pose(10.5).hit).toBe(true);
  expect(pose(10.5).y).toBe(frame.height * 0.76);
  const mid = pose(n.start - duration / 2);
  const quarter = pose(n.start - duration * 0.75);
  expect(
    Math.abs(quarter.x - (g.x(n.start, n.start - duration) * 0.75 + mid.x * 0.25)),
  ).toBeGreaterThan(20);
  const saved = pose(10.4);
  pose(20);
  pose(0);
  expect(pose(10.4)).toEqual(saved);
  for (const cps of [0.1, 0.4, 0.6, 1, 2]) {
    expect(diveDuration(cps) / cps).toBeGreaterThanOrEqual(0.25);
    expect(diveDuration(cps) / cps).toBeLessThanOrEqual(0.4 + Number.EPSILON);
  }
});
it('held bass flagships hover with exactly their scored remaining span', () => {
  const n = frame.notes.find((n) => n.start === 10 && n.end === 11 && n.value.note !== undefined)!;
  expect(isCarrier(n)).toBe(true);
  const g = formation(frame);
  const pose = (now: number) => enemyPose(n, { ...frame, now }, 120, g.x);
  expect(pose(9.999).diving).toBe(false);
  expect(pose(10).diving).toBe(true);
  expect(pose(10).y).toBe(120);
  expect(pose(10).remaining).toBe(1);
  expect(pose(10.4).remaining).toBeCloseTo(0.6);
  expect(pose(11).remaining).toBe(0);
  expect(pose(10.4).y).toBe(frame.height * 0.6);
  expect(pose(10.4).x).toBe(pose(10.8).x);
  expect(spriteRadius(n, frame.width)).toBe(enemySize(n, frame.width) * 1.5);
  expect(enemySize({ ...n, value: { gain: 0.4 } })).toBeLessThan(
    enemySize({ ...n, value: { gain: 1 } }),
  );
  expect(enemySize({ ...n, value: { gain: Infinity } })).toBe(enemySize({ ...n, value: {} }));
  const fragment = { ...n, hasOnset: false };
  expect(isCarrier(fragment)).toBe(true);
  expect(enemyPose(fragment, frame, 120, g.x).hit).toBe(false);
});
it('the actual next wave enters only in the second half, loops and settles before peeling off', () => {
  const n = frame.notes.find((n) => n.start === 11.5 && !isCarrier(n))!;
  expect(n).toBeDefined();
  const pose = (now: number) => {
    const f = { ...frame, now },
      g = formation(f);
    return enemyPose(n, f, 240, g.x);
  };
  expect(pose(10.49).visible).toBe(false);
  expect(pose(10.7).entering).toBe(true);
  expect(pose(11).entering).toBe(false);
  expect(pose(11).y).toBe(240);
  expect(entryPoint(1, { x: 600, y: 240 }, 1300, 760, 1)).toEqual({ x: 600, y: 240 });
  expect(entryPoint(0.5, { x: 600, y: 240 }, 1300, 760, 1).y).toBeGreaterThan(240);
});
it('keeps dives and hovering flagships continuous when a part leaves at the bar line', () => {
  const f = scoreFrame(4);
  const [leaving, diver, other, held] = [
    { instrument: '0', start: 0, end: 1, value: { note: 48 }, hasOnset: true },
    { instrument: '1', start: 1.05, end: 1.1, value: { s: 'sd' }, hasOnset: true },
    { instrument: '2', start: 1.75, end: 1.8, value: { s: 'hh' }, hasOnset: true },
    { instrument: '3', start: 0, end: 3, value: { note: 60 }, hasOnset: true },
  ];
  const pose = (now: number) => {
    const current = {
      ...f,
      now,
      notes: [leaving, diver, other, held],
      instruments: f.instruments.map((i) => ({ ...i, inSection: i.id !== '0' || now < 1 })),
    };
    const g = formation(current);
    const row = (id: string) => g.rows.find((row) => row.instrument.id === id)!;
    return {
      rowY: row('1').y,
      flagshipRowY: row('3').y,
      slotY: g.y(diver),
      diver: enemyPose(diver, current, g.y(diver), g.x),
      flagship: enemyPose(held, current, row('3').y, g.x),
    };
  };
  const before = pose(0.99999999),
    after = pose(1);
  expect(before.rowY).not.toBe(after.rowY);
  expect(before.flagshipRowY).not.toBe(after.flagshipRowY);
  expect(before.slotY).toBe(after.slotY);
  expect(before.diver.diving).toBe(true);
  expect(before.diver.x).toBeCloseTo(after.diver.x, 3);
  expect(before.diver.y).toBeCloseTo(after.diver.y, 3);
  expect(before.flagship.x).toBe(after.flagship.x);
  expect(before.flagship.y).toBe(after.flagship.y);
  pose(1.5);
  pose(0.5);
  expect(pose(1)).toEqual(after);
});
it('breathes by six percent on the scored steadiest drum and eases back', () => {
  const notes = [0, 0.25, 0.5, 0.75, 1].map((start) => ({
    instrument: 'drum',
    start,
    end: start + 0.01,
    hasOnset: true,
    value: { s: 'anything' },
  }));
  expect(drumPart(notes)).toBe('drum');
  expect(breathing({ notes, now: 0.25 })).toBe(1.06);
  expect(breathing({ notes, now: 0.375 })).toBeCloseTo(1.03);
  expect(breathing({ notes, now: 0.499999 })).toBeCloseTo(1);
  expect(breathing({ notes: [], now: 0.5 })).toBe(1);
});
it('meets successive short-note hit points smoothly, handles simultaneous onsets and centres in rests', () => {
  const notes = [0, 0.125, 0.25, 2].map((start) => ({
    instrument: '0',
    start,
    end: start + 0.01,
    hasOnset: true,
    value: {},
  }));
  const x = (now: number) => shipX({ ...frame, notes, now });
  for (const n of notes) expect(x(n.start)).toBe(hitX(n.start, frame.width));
  expect(x(1)).toBe(frame.width / 2);
  expect(shipX({ ...frame, notes: [], now: 1 })).toBe(frame.width / 2);
  expect(
    shipX({ ...frame, notes: notes.map((n) => ({ ...n, end: n.start + 1 })), now: 0.25 }),
  ).toBe(frame.width / 2);
  expect(shipX({ ...frame, notes: [...notes, { ...notes[1] }], now: 0.125 })).toBe(x(0.125));
  expect(x(0.125 - 1e-6)).toBeCloseTo(x(0.125 + 1e-6), 3);
  expect(x(0.06)).not.toBeCloseTo(frame.width * 0.15 + 0.06 * frame.width * 0.7);
});
it('scrolls two layers downward at different speeds, with stable seeds across bars', () => {
  const a = starPoint(7, 10, 0),
    b = starPoint(7, 10.1, 0),
    c = starPoint(7, 10.1, 1);
  expect(b.x).toBe(a.x);
  expect((b.y - a.y + 1) % 1).toBeCloseTo(0.0035);
  expect((c.y - starPoint(7, 10, 1).y + 1) % 1).toBeCloseTo(0.011);
  starPoint(7, 0, 0);
  starPoint(7, 20, 0);
  expect(starPoint(7, 10, 0)).toEqual(a);
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
});
it('warps actual next-bar notes across section changes rather than assuming a repeat', () => {
  for (const now of [3.4, 15.4]) {
    const g = formation({ ...frame, now });
    const bar = Math.floor(now) + 1;
    const next = g.rows.flatMap((r) => r.next);
    const expected = frame.notes.filter((n) => n.start >= bar && n.start < bar + 1);
    expect(next.length).toBeGreaterThan(0);
    expect(next).toHaveLength(expected.length);
    expect(next).toEqual(expect.arrayContaining(expected));
    expect(next.every((n) => n.start >= bar && n.start < bar + 1)).toBe(true);
    expect(new Set(next.map((n) => n.instrument))).not.toEqual(
      new Set(g.rows.flatMap((r) => r.notes).map((n) => n.instrument)),
    );
  }
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
      expect(new Set(g.rows.map((r) => r.y)).size).toBe(count);
    }
    expect(hitCount(f)).toBe(201);
    expect(hitCount({ ...f, now: 0.999 })).toBe(500);
  }
  expect(formation({ ...scoreFrame(1), notes: [] }).rows).toHaveLength(1);
  expect(formation({ ...frame, notes: [], instruments: [] }).rows).toEqual([]);
});

it('names waves at section boundaries and later song passes', () => {
  expect(wave(frame)).toEqual({ number: 3, name: 'drop' });
  expect(wave({ ...frame, now: 16 })).toEqual({ number: 4, name: 'breakdown' });
  expect(wave({ ...frame, now: 38.4 })).toEqual(wave(frame));
  expect(wave({ ...frame, sections: [] }).name).toBe('Open space');
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

it('scales ships to the desktop field and keeps Stage B silhouettes legible', () => {
  const n = frame.notes.find((n) => !isCarrier(n))!;
  for (const gain of [0.35, 0.5, 1]) {
    const normal = { ...n, value: { gain } };
    expect(enemySize(normal, 1300) * 2).toBeGreaterThanOrEqual(34);
    expect(enemySize(normal, 1300) * 2).toBeLessThanOrEqual(40);
    expect(enemySize(normal, 560) * 2).toBeGreaterThanOrEqual(18);
    expect(enemySize(normal, 560)).toBeLessThan(enemySize(normal, 1300));
  }
  expect(playerWidth(1300)).toBe(42);
  expect(playerWidth(560)).toBeGreaterThanOrEqual(18);
  const wide = formation({ ...frame, height: 760 });
  expect(wide.rows.at(-1)!.y).toBeCloseTo(760 * 0.45);
  expect(wide.rows.at(-1)!.y - wide.rows[0].y).toBeCloseTo(760 * 0.3);
  expect(wide.rows.every((row) => row.y < wide.shipY)).toBe(true);
});

it('keeps ordinary six-part rows as sprites in the standard Studio stage', () => {
  const g = formation({ ...frame, width: 1131, height: 468 });
  expect(g.rows).toHaveLength(6);
  expect(g.rows.every((row) => !row.crowded)).toBe(true);
});

it('counts overlapping flagships after different slots converge on their shared hover point', () => {
  const n = frame.notes.find((n) => n.start === 10 && n.end === 11 && n.value.note !== undefined)!;
  const layered = { ...frame, notes: [n, { ...n, start: 10.25, end: 11.25 }] };
  const row = formation(layered).rows.find((row) => row.instrument.id === n.instrument)!;
  expect(row.enemies).toHaveLength(2);
  expect(row.crowded).toBe(true);
});

it('does not name the first section while the playhead is in a section gap', () => {
  expect(
    wave({
      now: 1.5,
      sections: [
        { name: 'first', from: 0, to: 1 },
        { name: 'second', from: 2, to: 3 },
      ],
    }),
  ).toEqual({ number: 0, name: 'Open space' });
});

it('keeps onset-free continuations aligned with their current row after another part leaves', () => {
  const f = scoreFrame(3);
  const fragment = { instrument: '1', start: 0, end: 3, hasOnset: false, value: { note: 60 } };
  const notes = [
    { ...fragment, instrument: '0', end: 1, hasOnset: true },
    fragment,
    { instrument: '2', start: 1.5, end: 1.6, hasOnset: true, value: { s: 'hh' } },
  ];
  const at = (now: number) => {
    const current = { ...f, now, notes },
      g = formation(current);
    const row = g.rows.find((row) => row.instrument.id === fragment.instrument)!;
    const pose = enemyPose(fragment, current, g.y(fragment), g.x);
    expect(pose.hit).toBe(false);
    expect(pose.diving).toBe(false);
    expect(pose.y).toBe(row.y);
    return pose.y;
  };
  expect(at(0.99)).not.toBe(at(1));
});
