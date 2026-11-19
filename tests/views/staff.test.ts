import { describe, expect, it } from 'vitest';
import { scoreFrame } from './score-fixture';
import {
  inferKey,
  measure,
  nearestValue,
  staffScore,
  staffLayout,
  staffCapacity,
  scoreRange,
  writtenPitch,
} from '../../src/views/staff/model';
import type { ViewFrame, ViewNote } from '../../src/views/types';
const note = (
  start: number,
  end: number,
  value: ViewNote['value'] = { note: 'eb2' },
  instrument = 'part',
): ViewNote => ({ instrument, start, end, hasOnset: true, value });
const frame = (notes: ViewNote[]): ViewFrame => ({
  ...scoreFrame(),
  notes,
  now: 0,
  lookAhead: 2,
  instruments: [...new Set(notes.map((n) => n.instrument))].map((id, index) => ({
    id,
    name: id,
    index,
    colour: '#fff',
    sounding: true,
    inSection: true,
    muted: false,
    settings: [],
    rewrites: [],
    room: null,
  })),
});
describe('Staff notation', () => {
  it('writes flat minor material with the same pitch spellings as Chord bridge', () => {
    const notes = ['c1', 'c1', 'eb1', 'f1', 'g1', 'c2', 'eb2'].map((n, i) =>
      note(i, i + 1, { note: n }),
    );
    const key = inferKey(notes);
    expect(key.name).toBe('Cm');
    expect(writtenPitch(39, key.flats)).toBe('eb/2');
    expect(writtenPitch(27, key.flats, 1)).toBe('eb/2');
  });
  it('fills exact eighth-note rhythms with genuine rests and 64 ticks', () => {
    const m = measure([note(0, 0.125), note(0.5, 0.625)], 0, 20);
    expect(m.grouped).toBe(false);
    expect(m.approximate).toBe(0);
    expect(m.marks.reduce((n, m) => n + m.ticks, 0)).toBe(64);
    expect(m.marks.filter((m) => !m.rest).map((m) => m.tick)).toEqual([0, 32]);
    expect(m.marks.some((m) => m.rest)).toBe(true);
  });
  it('marks nearest-value rounding, including onset offsets and microtonal pitches', () => {
    expect(nearestValue(1 / 5)).toEqual({ ticks: 12, approximate: true });
    const m = measure([note(0.1, 0.3, { note: 60.2 })], 0, 20);
    expect(m.approximate).toBe(1);
    expect(m.marks.some((m) => m.approximate)).toBe(true);
  });
  it('ties notes across beats, bars and the queried window, retaining long durations', () => {
    const n = note(0.125, 2.125);
    const a = measure([n], 0, 20),
      b = measure([n], 1, 20),
      c = measure([n], 2, 20);
    expect(a.marks.at(-1)?.tieOut).toBe(true);
    expect(b.marks[0].tieIn).toBe(true);
    expect(b.marks[0].ticks).toBe(64);
    expect(b.marks[0].tieOut).toBe(true);
    expect(c.marks[0].tieIn).toBe(true);
    expect(c.marks[0].tieOut).toBe(false);
  });
  it('counts every dense, overlapping or out-of-register note', () => {
    for (const notes of [
      Array.from({ length: 500 }, (_, i) => note(i / 500, (i + 1) / 500)),
      [note(0, 0.8), note(0.2, 0.5)],
      [note(0, 1, { note: 120 })],
    ]) {
      const m = measure(notes, 0, 12);
      expect(m.grouped).toBe(true);
      expect(m.count).toBe(notes.length);
      expect(m.marks).toEqual([]);
    }
  });
  it('derives percussion roles from timing, ignoring sample indices and names', () => {
    const notes = [
      note(0, 0.125, { s: 'foo', n: 4 }, 'a'),
      note(1, 1.125, { s: 'foo', n: 4 }, 'a'),
      note(0.5, 0.625, { s: 'foo' }, 'b'),
      note(1.5, 1.625, { s: 'foo' }, 'b'),
      ...Array.from({ length: 16 }, (_, i) => note(i / 8, (i + 1) / 8, { s: 'foo' }, 'c')),
      note(0.25, 0.375, { s: 'foo' }, 'd'),
      note(0.75, 0.875, { s: 'foo' }, 'd'),
    ];
    const result = staffScore(frame(notes));
    expect(result.parts.map((p) => p.role)).toEqual(['kick', 'snare', 'hat', 'open hat']);
    expect(result.parts.every((p) => p.clef === 'percussion')).toBe(true);
  });
  it('deduplicates carried whole spans while preserving simultaneous onset unisons', () => {
    const n = note(0, 2);
    const carried = { ...n, hasOnset: false };
    expect(staffScore(frame([carried, carried])).notes).toHaveLength(1);
    expect(staffScore(frame([n, n, carried])).notes).toHaveLength(2);
    expect(measure([n, n], 0, 20).count).toBe(2);
    expect(measure([n, n], 0, 20).grouped).toBe(true);
  });
});

it('engraves the real Dubstep check moment as two bass voices and four timing-derived drum voices', async () => {
  const { readFileSync } = await import('node:fs');
  const { importStrudel } = await import('../../src/import');
  const { initialState, loadPiece } = await import('../../src/app/state');
  const { generate } = await import('../../src/generate');
  const { viewNotes } = await import('../../src/studio/frame');
  const { queryEventsNode } = await import('../node-query');
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  const entries = await Promise.all(
    state.rows.map(
      async (row) =>
        [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 4, 20)] as const,
    ),
  );
  const notes = viewNotes({ from: 4, to: 20, events: Object.fromEntries(entries) });
  const f = frame(notes);
  const score = staffScore({ ...f, now: 10.4 });
  const active = score.parts.filter((p) => p.notes.some((n) => n.start < 12 && n.end > 10));
  expect(score.key.name).toBe('Cm');
  expect(active.find((p) => p.cutoff)?.cutoff).toBe('lpf 1370 Hz · held');
  expect(
    active.filter((p) => p.role === 'kick' || p.role === 'snare').map((p) => p.dynamics),
  ).toEqual(['f', 'f']);
  expect(
    active
      .filter((p) => p.clef === 'bass')
      .map((p) => p.octave)
      .sort(),
  ).toEqual([0, 1]);
  expect(
    active
      .filter((p) => p.clef === 'percussion')
      .map((p) => p.role)
      .sort(),
  ).toEqual(['hat', 'kick', 'open hat', 'snare']);
  expect(
    active.map((p) => [measure(p.notes, 10, 30).count, measure(p.notes, 11, 30).count]),
  ).toEqual([
    [1, 1],
    [1, 1],
    [8, 8],
    [2, 2],
    [1, 2],
    [1, 2],
  ]);
  expect(
    active.reduce(
      (sum, p) => sum + measure(p.notes, 10, 30).approximate + measure(p.notes, 11, 30).approximate,
      0,
    ),
  ).toBe(0);
  console.log(
    'Staff real mapping',
    active.map((p) => ({
      id: p.id,
      role: p.role,
      clef: p.clef,
      octave: p.octave,
      cutoff: p.cutoff,
      dynamics: p.dynamics,
    })),
  );
});

it('counts degenerate spans explicitly rather than silently drawing silence', () => {
  const notes = [note(0, 0), note(0.5, 0.4)];
  expect(staffScore(frame(notes)).notes).toHaveLength(2);
  const m = measure(notes, 0, 20);
  expect(m.grouped).toBe(true);
  expect(m.count).toBe(2);
});

it('gives a wide chord a bass and treble voice without losing a chord tone', () => {
  const notes = [48, 55, 63].map((midi) => note(0, 1, { note: midi }));
  const score = staffScore(frame(notes));
  expect(score.parts.map((p) => p.clef)).toEqual(['bass', 'treble']);
  expect(score.parts.map((p) => measure(p.notes, 0, 20).count)).toEqual([2, 1]);
  expect(score.parts.every((p) => !measure(p.notes, 0, 20).grouped)).toBe(true);
});

it('separates a four-on-the-floor kick from equally dense offbeat hats by scored timing', () => {
  const notes = [
    ...Array.from({ length: 4 }, (_, i) => note(i / 4, (i + 1) / 4, { s: 'x' }, 'a')),
    ...Array.from({ length: 4 }, (_, i) => note((i * 2 + 1) / 8, (i * 2 + 2) / 8, { s: 'x' }, 'b')),
    note(0.25, 0.5, { s: 'x' }, 'c'),
    note(0.75, 1, { s: 'x' }, 'c'),
  ];
  expect(staffScore(frame(notes)).parts.map((p) => p.role)).toEqual(['kick', 'hat', 'snare']);
});

it('annotates dynamics and held cutoff from the written window, not buffered future sections', () => {
  const score = staffScore(
    frame([
      note(0, 1, { note: 48, gain: 0.75, lpf: 1200 }),
      note(10, 11, { note: 48, gain: 0.1, lpf: 8000 }),
    ]),
  );
  expect(score.parts[0].dynamics).toBe('f');
  expect(score.parts[0].cutoff).toBe('lpf 1200 Hz · held');
});

it('marks time outside the query as unasked, rather than empty bars', () => {
  expect(scoreRange({ ...frame([]), now: 11.4, from: 4, to: 12 }).asked).toEqual([true, false]);
  expect(scoreRange({ ...frame([]), now: 22, from: 4, to: 12 }).asked).toEqual([false, false]);
});

it('fits two ledger-line bass staves and both kit stem directions in the real short stage', () => {
  expect(staffCapacity(468.094, true)).toBe(3);
  const box = staffLayout(['bass', 'bass', 'percussion'], 468.094, 2);
  expect(box.tops[1] - box.tops[0]).toBeGreaterThanOrEqual(100);
  expect(box.tops[2] - box.tops[1]).toBeGreaterThanOrEqual(100);
  expect(box.heights[2]).toBeGreaterThanOrEqual(144);
  expect(box.bottom + 48).toBeLessThan(468.094);
});
