import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { type AppState, initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { neededRange, sectionMembership, viewNotes } from '../../src/studio/frame';
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
let state: AppState;
let programs: { id: string; source: string }[];
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  state = loadPiece(initialState(), source, importStrudel(source));
  programs = state.rows.map((row) => ({
    id: row.id,
    source: generate(state.doc!, { only: row.id }),
  }));
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
it('reserves contiguous instrument runs and maps pitch classes and cyclic unpitched lanes without names', () => {
  const parts = analyse(frame.notes),
    tube = layout(frame, parts);
  expect(tube.runs).toHaveLength(frame.instruments.length);
  expect(tube.lanes).toBe(32);
  expect(tube.logical).toBe(52);
  let start = 0;
  for (const run of tube.runs) {
    expect(run.start).toBe(start);
    start += run.count;
    for (const event of run.part.events) {
      expect(laneFor(event, run)).toBeGreaterThanOrEqual(run.start);
      expect(laneFor(event, run)).toBeLessThan(run.start + run.count);
    }
  }
  // Use an actual eight-onset corpus part in isolation: equal subdivisions
  // advance around its run, independent of earlier queried cycles.
  const hats = [...parts.entries()].find(
    ([, p]) =>
      p.events.filter(
        (e) => !e.pitched && e.note.hasOnset && e.note.start >= 10 && e.note.start < 11,
      ).length === 8,
  )!;
  const instrument = frame.instruments.find((i) => i.id === hats[0])!;
  const run = layout({ ...frame, instruments: [instrument] }, parts).runs[0];
  expect(
    run.part.events
      .filter((e) => e.note.start >= 10 && e.note.start < 11)
      .map((e) => laneFor(e, run)),
  ).toEqual([2, 3, 4, 5, 6, 7, 0, 1]);
  expect(
    layout(
      { ...frame, instruments: frame.instruments.map((i) => ({ ...i, name: 'renamed' })) },
      parts,
    ).runs.map((r) => [r.start, r.count]),
  ).toEqual(tube.runs.map((r) => [r.start, r.count]));
});
it('separates different pitch-class bins in an unmerged corpus chord run', () => {
  const chord = frame.notes.filter(
    (n) => n.hasOnset && n.start === 0 && ['c3', 'eb4', 'g3'].includes(String(n.value.note)),
  );
  expect(chord).toHaveLength(3);
  const tube = layout({ ...frame, instruments: frame.instruments.slice(0, 2) }, analyse(chord));
  expect(tube.merged).toBe(false);
  const run = tube.runs.find((r) => r.instrument.id === chord[0].instrument)!;
  const lanes = ['c3', 'eb4', 'g3'].map((note) =>
    laneFor(run.part.events.find((e) => e.note.value.note === note)!, run),
  );
  expect(lanes).toEqual([run.start, run.start + 1, run.start + 2]);
});
it('cycles long unpitched corpus spans one lane per onset', () => {
  const hits = frame.notes.filter((n) => n.hasOnset && n.value.s === 'hh' && n.start < 1);
  expect(hits).toHaveLength(4);
  const notes = hits.map((n) => ({ ...n, start: n.start * 16, end: n.end * 16 }));
  const instrument = frame.instruments.find((i) => i.id === hits[0].instrument)!;
  const run = layout({ ...frame, instruments: [instrument] }, analyse(notes)).runs[0];
  expect(run.part.events.map((e) => laneFor(e, run))).toEqual([0, 1, 2, 3]);
});
async function queriedFrame(now: number, lookAhead: number): Promise<ViewFrame> {
  const range = neededRange(undefined, now, lookAhead, state.sections);
  const entries = await Promise.all(
    programs.map(
      async (p) => [p.id, await queryEventsNode(p.source, range.from, range.to)] as const,
    ),
  );
  for (const [, result] of entries) expect(result.error).toBeNull();
  const members = sectionMembership(state, now);
  return {
    ...frame,
    ...range,
    now,
    lookAhead,
    notes: viewNotes({ ...range, events: Object.fromEntries(entries) }),
    instruments: frame.instruments.map((i) => ({
      ...i,
      inSection: members?.has(i.id) ?? i.inSection,
    })),
  };
}
it('keeps in-flight corpus enemies in their lanes when the real host query window slides', async () => {
  for (const lookAhead of [1, 2])
    for (const boundary of [8, 12, 20]) {
      const before = await queriedFrame(boundary - 0.05, lookAhead);
      const after = await queriedFrame(boundary, lookAhead);
      expect(after.from).toBe(before.from + 4);
      const old = layout(before, analyse(before.notes)),
        next = layout(after, analyse(after.notes));
      expect(next.runs.map((r) => [r.instrument.id, r.start, r.count])).toEqual(
        old.runs.map((r) => [r.instrument.id, r.start, r.count]),
      );
      const addresses = (tube: ReturnType<typeof layout>) =>
        tube.runs.flatMap((r) =>
          r.part.events
            .filter(
              (e) =>
                e.note.hasOnset &&
                e.note.start >= boundary &&
                e.note.start <= before.now + lookAhead,
            )
            .map((e) => [
              JSON.stringify([r.instrument.id, e.note.start, e.note.end, e.note.value]),
              laneFor(e, r),
            ]),
        );
      expect(addresses(old).length).toBeGreaterThan(0);
      expect(addresses(next)).toEqual(addresses(old));
    }
});
it('keeps a held unpitched lane when its onset cycle falls outside the query', () => {
  const source = frame.notes.find((n) => n.hasOnset && n.value.s === 'hh')!;
  const held = { ...source, start: 3.75, end: 13.75 };
  const before = layout(frame, analyse([{ ...source, start: 3.5, end: 3.6 }, held]));
  const after = layout({ ...frame, now: 12 }, analyse([{ ...held, hasOnset: false }]));
  const oldRun = before.runs.find((r) => r.instrument.id === held.instrument)!;
  const newRun = after.runs.find((r) => r.instrument.id === held.instrument)!;
  expect(laneFor(oldRun.part.events[1], oldRun)).toBe(laneFor(newRun.part.events[0], newRun));
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
  expect(
    sectionAt({ ...frame, sections: [{ name: 'only', from: 0, to: 28 }] }).next,
  ).toBeUndefined();
  expect(tubePoint({ ...g, shape: 4 }, 2, 0)).not.toEqual(tubePoint({ ...g, shape: 0 }, 2, 0));
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
    expect(tube.merged).toBe(count === 20);
    expect(tube.lanes).toBe(count === 20 ? 32 : 8);
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
