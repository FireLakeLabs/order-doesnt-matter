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
  analyse,
  depth,
  enemyRadius,
  geometry,
  laneFor,
  lanePoint,
  latestTargets,
  layout,
  sectionAt,
  tubePoint,
} from '../../src/views/rimshot/model';
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
    lookAhead: 1,
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
it('assigns actual drop instruments contiguous runs, pitched order and cycling unpitched lanes without names', () => {
  const parts = analyse(frame.notes),
    tube = layout(frame, parts);
  expect(tube.runs).toHaveLength(6);
  expect(tube.lanes).toBe(18);
  let start = 0;
  for (const run of tube.runs) {
    expect(run.start).toBe(start);
    start += run.count;
    for (const event of run.part.events) {
      expect(laneFor(event, run)).toBeGreaterThanOrEqual(run.start);
      expect(laneFor(event, run)).toBeLessThan(run.start + run.count);
    }
    if (run.part.pitches.length) {
      const hits = run.part.events.filter(
        (e) => e.note.start >= 8 && e.note.start < 16 && e.pitched,
      );
      expect(new Set(hits.map((e) => laneFor(e, run))).size).toBe(run.part.pitches.length);
    }
  }
  const hats = tube.runs.find((r) => !r.part.pitches.length && r.count === 4)!;
  const lanes = hats.part.events
    .filter((e) => e.note.start >= 10 && e.note.start < 11)
    .map((e) => laneFor(e, hats) - hats.start);
  expect(lanes).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  const sparse = tube.runs.find(
    (r) => !r.part.pitches.length && r.part.events.some((e) => e.note.start === 8) && r.count === 2,
  )!;
  expect(
    sparse.part.events
      .filter((e) => e.note.start >= 8 && e.note.start < 12)
      .map((e) => laneFor(e, sparse) - sparse.start),
  ).toEqual([0, 1, 0, 1]);
  expect(
    layout(
      { ...frame, instruments: frame.instruments.map((i) => ({ ...i, name: 'renamed' })) },
      parts,
    ).runs.map((r) => [r.start, r.count]),
  ).toEqual(tube.runs.map((r) => [r.start, r.count]));
});
it('places the far end one Window ahead and reaches the rim exactly on onset at every Window size', () => {
  for (const lookAhead of [1, 2, 4, 8]) {
    const f = { ...frame, lookAhead };
    expect(depth(f.now + lookAhead, f)).toBeCloseTo(1);
    expect(depth(f.now + lookAhead / 2, f)).toBeCloseTo(0.5);
    expect(depth(f.now, f)).toBe(0);
    const g = geometry(f, 18, 2),
      rim = lanePoint(g, 4, 0),
      far = lanePoint(g, 4, 1);
    expect(lanePoint(g, 4, depth(f.now, f))).toEqual(rim);
    expect(Math.hypot(far.x - g.cx, far.y - g.cy)).toBeLessThan(
      Math.hypot(rim.x - g.cx, rim.y - g.cy) / 5,
    );
  }
});
it('lights held bass spans back to their exact ends and folds only continuation fragments', () => {
  const parts = analyse(frame.notes);
  const bass = [...parts.values()].filter((p) =>
    p.events.some((e) => e.note.start === 10 && e.note.end === 11),
  );
  expect(bass).toHaveLength(2);
  for (const p of bass)
    expect(p.events.filter((e) => e.note.start === 10 && e.note.end === 11)).toHaveLength(1);
  expect(depth(11, frame)).toBeCloseTo(0.6);
  expect(depth(11, { ...frame, now: 10.8 })).toBeCloseTo(0.2);
  const n = bass[0].events.find((e) => e.note.start === 10)!.note;
  const chord = [60, 64, 67].map((note) => ({ ...n, hasOnset: false, value: { note } }));
  expect(analyse(chord).get(n.instrument)!.events).toHaveLength(3);
  expect(analyse([n, { ...n }]).get(n.instrument)!.events).toHaveLength(2);
});
it('moves the claw to every simultaneous onset, ignores fragments, and reverses without history', () => {
  const parts = analyse(frame.notes);
  const f = { ...frame, now: 10.5 },
    tube = layout(f, parts);
  const expected = new Set(
    tube.runs.flatMap((r) =>
      r.part.events
        .filter((e) => e.note.hasOnset && e.note.start === 10.5)
        .map((e) => laneFor(e, r)),
    ),
  );
  expect(expected.size).toBe(2);
  expect(new Set(latestTargets(f, tube.runs))).toEqual(expected);
  latestTargets({ ...f, now: 20 }, tube.runs);
  latestTargets({ ...f, now: 0 }, tube.runs);
  expect(new Set(latestTargets(f, tube.runs))).toEqual(expected);
  expect(
    latestTargets(
      f,
      tube.runs.map((r) => ({ ...r, instrument: { ...r.instrument, muted: true } })),
    ),
  ).toEqual([]);
  const fragments = analyse(frame.notes.map((n) => ({ ...n, hasOnset: false })));
  expect(latestTargets(f, layout(f, fragments).runs)).toEqual([]);
});
it('changes tube shape by section and previews the real next boundary including song repeats', () => {
  const current = sectionAt(frame),
    edge = sectionAt({ ...frame, now: 15.9 });
  expect(current.index).toBe(2);
  expect(edge.next).toMatchObject({ index: 3, name: 'breakdown', at: 16 });
  const g = geometry(frame, 18, current.index);
  expect(tubePoint({ ...g, shape: edge.next!.index }, 2, 0)).not.toEqual(tubePoint(g, 2, 0));
  expect(sectionAt({ ...frame, now: 38.4 }).index).toBe(2);
  expect(sectionAt({ ...frame, now: 27.9 }).next).toMatchObject({ index: 0, at: 28 });
  expect(sectionAt({ ...frame, sections: [] }).next).toBeUndefined();
});
it('merges over 32 lanes, shrinks enemies and keeps all 500 corpus-derived onsets at one and twenty instruments', () => {
  const source = frame.notes.find((n) => n.hasOnset && n.start === 10)!;
  for (const count of [1, 20]) {
    const f = { ...scoreFrame(count), now: 0, lookAhead: 1 };
    f.notes = Array.from({ length: 500 }, (_, i) => ({
      ...source,
      instrument: String(i % count),
      start: i / 500,
      end: (i + 1) / 500,
      value: count === 1 ? { note: i } : {},
    }));
    const tube = layout(f, analyse(f.notes));
    expect(tube.merged).toBe(true);
    expect(tube.lanes).toBe(32);
    expect(tube.runs).toHaveLength(count);
    expect(tube.runs.reduce((n, r) => n + r.part.events.length, 0)).toBe(500);
    expect(tube.runs.every((r) => r.count >= 1)).toBe(true);
    expect(
      tube.runs
        .flatMap((r) => r.part.events.map((e) => laneFor(e, r)))
        .every((lane) => lane >= 0 && lane < 32),
    ).toBe(true);
    expect(enemyRadius(f, 0.1, true)).toBeLessThan(enemyRadius(f, 0.1, false));
  }
});
it('fits a full tube and readable rim enemies on both stages, including a lone instrument and empty score', () => {
  for (const width of [560, 1300]) {
    const f = {
      ...scoreFrame(1),
      width,
      notes: frame.notes.slice(0, 1).map((n) => ({ ...n, instrument: '0' })),
    };
    const tube = layout(f, analyse(f.notes));
    expect(tube.lanes).toBeGreaterThanOrEqual(8);
    const g = geometry(f, tube.lanes, 0);
    expect(g.rx * 2).toBeGreaterThan(width * 0.8);
    expect(enemyRadius(f, 0, false) * 2).toBeGreaterThanOrEqual(28);
    for (let i = 0; i < tube.lanes; i++) {
      const p = tubePoint(g, i, 0);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(width);
      expect(p.y).toBeGreaterThan(70);
      expect(p.y).toBeLessThan(f.height - 20);
    }
  }
  expect(layout({ ...frame, notes: [], instruments: [] }, analyse([])).runs).toEqual([]);
});
