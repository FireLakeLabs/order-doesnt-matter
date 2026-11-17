import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import { bypass, departure, indexMetro, metroLayout } from '../../src/views/metro/model';
import type { ViewFrame } from '../../src/views/types';

const corpus = new Map<string, ViewFrame>();
beforeAll(async () => {
  for (const file of ['real-dubstep-arranged', 'real-techno']) {
    const source = readFileSync(`corpus/programs/${file}.strudel`, 'utf8');
    const state = loadPiece(initialState(), source, importStrudel(source));
    const frame = scoreFrame(state.rows.length);
    frame.sections = state.sections.map((s) => ({
      name: s.name,
      from: s.start,
      to: s.start + s.cycles,
    }));
    frame.to = frame.sections.at(-1)?.to ?? 16;
    const entries = await Promise.all(
      state.rows.map(
        async (row) =>
          [
            row.id,
            await queryEventsNode(generate(state.doc!, { only: row.id }), 0, frame.to),
          ] as const,
      ),
    );
    for (const [, result] of entries) expect(result.error).toBeNull();
    frame.notes = viewNotes({ from: 0, to: frame.to, events: Object.fromEntries(entries) });
    frame.instruments.forEach((i, n) => {
      i.id = state.rows[n].id;
      i.name = state.rows[n].name;
    });
    corpus.set(file, frame);
  }
});

it('places real sections proportionally and boards the six departures and three arrivals at bar 11.4', () => {
  const frame = corpus.get('real-dubstep-arranged')!;
  const score = indexMetro(frame);
  expect(score.stations.map((s) => [s.name, s.from, s.to])).toEqual([
    ['intro', 0, 4],
    ['buildSection', 4, 8],
    ['drop', 8, 16],
    ['breakdown', 16, 20],
    ['drop', 20, 28],
  ]);
  expect(score.stations.map((s) => s.members.size)).toEqual([3, 4, 6, 3, 6]);
  const box = metroLayout(score, 1300, 760, frame.instruments.length);
  expect(box.x(16) - box.x(8)).toBeCloseTo(2 * (box.x(8) - box.x(4)));
  const chant = frame.instruments.find((i) => i.name === 'preDropVocal')!;
  expect(score.routes.get(chant.id)?.filter((run) => run.active)).toEqual([
    { from: 7, to: 8, active: true },
  ]);
  const board = departure(score, 10.4, frame.instruments);
  expect(board.name).toBe('breakdown');
  expect(board.bars).toBeCloseTo(5.6);
  expect(board.leaving).toEqual([
    'dubstepDrums · bd',
    'dubstepDrums · sd',
    'dubstepDrums · hh',
    'dubstepDrums · oh',
    'subBass',
    'wobbleBass',
  ]);
  expect(board.joining).toEqual(['darkPad', 'vocalAtmos', 'breakdown · triangle']);
  departure(score, 24, frame.instruments);
  expect(departure(score, 10.4, frame.instruments)).toEqual(board);
  expect(departure(score, 16, frame.instruments).name).toBe('drop');
  expect(departure(score, 27.5, frame.instruments).name).toBe('End');
  expect(departure(score, 28, frame.instruments)).toMatchObject({
    name: 'End',
    bars: 0,
    leaving: [],
    joining: [],
  });
});

it('reaches the correct stations in later host score repeats and uses note membership despite names and flags', () => {
  const original = corpus.get('real-dubstep-arranged')!;
  const frame = {
    ...original,
    from: 28,
    to: 56,
    notes: original.notes.map((n) => ({ ...n, start: n.start + 28, end: n.end + 28 })),
    instruments: original.instruments.map((i) => ({
      ...i,
      name: 'renamed',
      inSection: false,
      muted: true,
      sounding: false,
    })),
  };
  const score = indexMetro(frame);
  expect(score.stations[0].from).toBe(28);
  const board = departure(score, 38.4, frame.instruments);
  expect(board.name).toBe('breakdown');
  expect(board.bars).toBeCloseTo(5.6);
  expect(board.leaving).toHaveLength(6);
  expect(board.joining).toHaveLength(3);
});

it('gives unsectioned techno one station every four cycles, and labels the sampled edge honestly', () => {
  const frame = corpus.get('real-techno')!;
  const score = indexMetro(frame);
  expect(frame.sections).toHaveLength(0);
  expect(score.stations.map((s) => s.from)).toEqual([0, 4, 8, 12]);
  for (const s of score.stations) {
    expect(s.members).toEqual(
      new Set(frame.notes.filter((n) => n.end > s.from && n.start < s.to).map((n) => n.instrument)),
    );
  }
  expect(departure(score, 3.25, frame.instruments)).toMatchObject({ name: 'Bar 5', bars: 0.75 });
  expect(departure(score, 15, frame.instruments)).toMatchObject({
    name: 'Window edge',
    leaving: [],
    joining: [],
  });
});

it('uses exact overlap at fractional sections, including held notes and fragments', () => {
  const frame = scoreFrame();
  frame.to = 2;
  frame.sections = [
    { name: 'a', from: 0, to: 0.5 },
    { name: 'b', from: 0.5, to: 2 },
  ];
  frame.notes = [
    { instrument: 'held', start: 0.25, end: 0.75, hasOnset: false, value: {} },
    { instrument: 'late', start: 0.5, end: 1, hasOnset: true, value: {} },
    { instrument: 'early', start: 0, end: 0.5, hasOnset: true, value: {} },
  ];
  expect(indexMetro(frame).stations.map((s) => [...s.members].sort())).toEqual([
    ['early', 'held'],
    ['held', 'late'],
  ]);
});

it('keeps one and twenty lines, shares only crowded rests, and fits true 45 degree transitions', () => {
  const score = indexMetro(corpus.get('real-dubstep-arranged')!);
  for (const count of [1, 12, 13, 20]) {
    for (const width of [560, 1300]) {
      const box = metroLayout(score, width, 760, count);
      expect(box.ys).toHaveLength(count);
      expect(box.shared).toBe(count > 12);
      for (let row = 0; row < count; row++) {
        for (const runs of score.routes.values()) {
          runs.forEach((run, index) => {
            if (run.active) return;
            const points = bypass(
              box.x(run.from),
              box.x(run.to),
              box.rest(row),
              box.ys[row],
              index > 0 && (runs.at(index - 1)?.active ?? false),
              runs.at(index + 1)?.active ?? false,
            );
            expect(points[1].x).toBeLessThanOrEqual(points[2].x);
            expect(Math.abs(points[1].x - points[0].x)).toBeCloseTo(
              Math.abs(points[1].y - points[0].y),
            );
            expect(Math.abs(points[3].x - points[2].x)).toBeCloseTo(
              Math.abs(points[3].y - points[2].y),
            );
          });
        }
      }
    }
  }
});

it('keeps separate bypass lines readable through a one-bar rest in a 64-bar corpus score', () => {
  const source = corpus.get('real-techno')!;
  const frame = scoreFrame(6);
  frame.to = 64;
  frame.sections = [{ name: 'Long section', from: 0, to: 64 }];
  frame.notes = frame.instruments.flatMap((instrument, row) =>
    Array.from({ length: 4 }, (_, repeat) =>
      source.notes
        .filter(
          (note) => note.instrument === source.instruments[row % source.instruments.length].id,
        )
        .flatMap((note) => {
          const start = note.start + repeat * 16;
          if (row === 0 && start >= 32 && start < 33) return [];
          return [{ ...note, instrument: instrument.id, start, end: note.end + repeat * 16 }];
        }),
    ).flat(),
  );
  const score = indexMetro(frame);
  expect(score.minimumRest).toBe(1);
  const box = metroLayout(score, 1000, 760, 6);
  expect(box.pitch).toBeGreaterThanOrEqual(4);
  for (let row = 0; row < 6; row++) {
    expect(2 * Math.abs(box.rest(row) - box.ys[row])).toBeLessThan(box.scale);
  }
});

it('aggregates every note at 500 notes/cycle without losing instrument participation', () => {
  const frame = corpus.get('real-techno')!;
  const dense = {
    ...frame,
    notes: Array.from({ length: 16 * 500 }, (_, i) => ({
      ...frame.notes[i % frame.notes.length],
      start: i / 500,
      end: (i + 0.5) / 500,
    })),
  };
  const score = indexMetro(dense);
  for (const station of score.stations) {
    expect(station.members).toEqual(
      new Set(
        dense.notes
          .filter((n) => n.end > station.from && n.start < station.to)
          .map((n) => n.instrument),
      ),
    );
  }
});
