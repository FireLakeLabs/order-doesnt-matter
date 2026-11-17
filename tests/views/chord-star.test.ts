import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import {
  analyse,
  at,
  barChord,
  fifths,
  position,
  readPitch,
} from '../../src/views/chord-star/model';
import type { ViewNote } from '../../src/views/types';
import { scoreFrame } from './score-fixture';

let notes: ViewNote[];
let ids: string[];
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  ids = state.rows.map((r) => r.id);
  const entries = await Promise.all(
    state.rows.map(async (row) => {
      const result = await queryEventsNode(generate(state.doc!, { only: row.id }), 0, 28);
      expect(result.error).toBeNull();
      return [row.id, result] as const;
    }),
  );
  notes = viewNotes({ from: 0, to: 28, events: Object.fromEntries(entries) });
});
function frame(now = 17.3) {
  const f = scoreFrame(ids.length);
  f.instruments.forEach((i, index) => {
    i.id = ids[index];
    i.name = 'renamed';
  });
  return { ...f, now, notes, from: 0, to: 28 };
}
it('places pitch classes in fifths order regardless of octave and input order', () => {
  expect(fifths).toEqual([0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]);
  expect(position(0)).toBe(-Math.PI / 2);
  const state = at(frame(), analyse(notes));
  expect(state.current.classes).toEqual([0, 8, 3]);
  expect(state.current.name).toBe('A♭ major');
  expect(state.current.lowest).toBe(44);
  expect(state.current.pitches).toEqual([44, 51, 60, 63]);
  expect(at(frame(), analyse([...notes].reverse()))).toEqual(state);
});
it('names the real bars 17–20 by simultaneous occupancy, without mixing successive lead pitches into chords', () => {
  const score = analyse(notes);
  expect([16, 17, 18, 19].map((b) => barChord(score, b, 0, 28)?.name)).toEqual([
    'C minor',
    'A♭ major',
    'F minor',
    'G major',
  ]);
  expect(at(frame(10.4), score).current.name).toBe('E♭');
  expect(barChord(score, 17, 17.1, 20)).toBeUndefined();
});
it('uses scored half-open spans, previews only within the window, and returns identical state after scrubbing', () => {
  const f = frame(),
    score = analyse(notes),
    state = at(f, score);
  expect(state.previous?.chord.name).toBe('A♭ major 7');
  expect(state.next?.from).toBe(17.5);
  expect(state.next?.chord.name).toBe('C · D · A♭ · E♭');
  at({ ...f, now: 2 }, score);
  at({ ...f, now: 25 }, score);
  expect(at(f, score)).toEqual(state);
  expect(at({ ...f, trails: 0 }, score).fade).toBe(0);
  expect(at({ ...f, lookAhead: 0.1 }, score).next).toBeUndefined();
  expect(at(frame(18), score).current.name).toBe('C · G · A♭ · F');
  expect(at(frame(18.125), score).current.name).toBe('F minor');
  expect(at({ ...f, now: 100 }, score).current.points).toEqual([]);
});
it('reads frequency and resolved scale degrees while retaining sample instruments as unpitched', async () => {
  const samples = notes.filter((n) => n.value.s === 'ade');
  expect(samples.length).toBeGreaterThan(0);
  expect(samples.every((n) => readPitch(n.value) === undefined)).toBe(true);
  expect(readPitch({ n: 0 })).toBeUndefined();
  expect(readPitch({ freq: 440, n: 0 })).toBe(69);
  const result = await queryEventsNode('n("0 2 4").scale("C:major").s("sine")', 0, 1);
  expect(result.error).toBeNull();
  const scaled = viewNotes({ from: 0, to: 1, events: { scale: result } });
  expect(scaled.map((n) => readPitch(n.value))).toEqual([48, 52, 55]);
  const scaledScore = analyse(scaled);
  expect(scaledScore.pitched).toEqual(new Set(['scale']));
  const score = analyse(notes);
  for (const n of samples) expect(score.unpitched.has(n.instrument)).toBe(true);
});
it('aggregates every dense note into counted instrument/class occupancy for one or twenty instruments', () => {
  const real = notes.find((n) => n.value.note !== undefined)!;
  for (const count of [1, 20]) {
    const dense = Array.from({ length: 500 }, (_, i) => ({
      ...real,
      instrument: String(i % count),
      start: 0,
      end: 1,
      value: { note: 36 + (i % 48) },
      hasOnset: false,
    }));
    const f = { ...scoreFrame(count), now: 0.5, notes: dense };
    const state = at(f, analyse(dense)).current;
    expect(state.points.reduce((n, p) => n + p.count, 0)).toBe(500);
    expect(new Set(state.points.map((p) => p.instrument)).size).toBe(count);
    expect(state.classes).toHaveLength(12);
    expect(state.points.length).toBeLessThanOrEqual(12 * count);
    expect(at({ ...f, now: 1 }, analyse(dense)).current.pitches).toEqual([]);
    const staggered = analyse(dense.map((n, i) => ({ ...n, start: i / 500, end: 1 + i / 500 })));
    expect(at({ ...f, now: 0.4 }, staggered).current.points.reduce((n, p) => n + p.count, 0)).toBe(
      201,
    );
    expect(
      at({ ...f, now: 0.999 }, staggered).current.points.reduce((n, p) => n + p.count, 0),
    ).toBe(500);
  }
});
it('honours muted parts without changing unpitched inventory and lists non-chords rather than guessing', () => {
  const f = frame(),
    score = analyse(notes);
  const muted = new Set(score.pitched);
  const silent = analyse(notes, muted);
  expect(at(f, silent).current.name).toBe('No pitched notes');
  expect(silent.unpitched).toEqual(score.unpitched);
  expect(at({ ...f, notes: [] }, analyse([])).current.name).toBe('No pitched notes');
  const n = notes.find((n) => n.value.note !== undefined)!;
  const cluster = [60, 61, 67].map((p) => ({ ...n, start: 0, end: 1, value: { note: p } }));
  expect(at({ ...f, now: 0.5 }, analyse(cluster)).current.name).toBe('C · G · D♭');
  const micro = cluster.map((n, i) => ({ ...n, value: { note: [60.1, 64, 67][i] } }));
  expect(at({ ...f, now: 0.5 }, analyse(micro)).current.root).toBeUndefined();
});

it('names exact sevenths, and the bar strip never invents a triad from successive notes', () => {
  const real = notes.find((n) => n.value.note !== undefined)!;
  const span = (p: number, start: number, end: number): ViewNote => ({
    ...real,
    start,
    end,
    value: { note: p },
  });
  const seventh = [60, 64, 67, 70].map((p) => span(p, 0, 1));
  expect(at({ ...frame(), now: 0.5 }, analyse(seventh)).current.name).toBe('C dominant 7');
  const successive = [span(60, 0, 0.25), span(64, 0.25, 0.5), span(67, 0.5, 1)];
  expect(barChord(analyse(successive), 0, 0, 1)?.name).toBe('G');
  const tied = [span(60, 0, 0.5), span(64, 0.5, 1)];
  expect(barChord(analyse(tied.reverse()), 0, 0, 1)?.name).toBe('C');
});

it('treats frequency round-off and octave changes as the same pitch-class chord', () => {
  const real = notes.find((n) => n.value.note !== undefined)!;
  const voiced = [60, 64, 67].map((p) => ({ ...real, start: 0, end: 0.5, value: { note: p } }));
  const frequencies = [72, 76, 79].map((p) => ({
    ...real,
    start: 0.5,
    end: 1,
    value: { freq: 440 * 2 ** ((p - 69) / 12) },
  }));
  const score = analyse([...voiced, ...frequencies]);
  expect(score.segments.map((s) => s.chord.name)).toEqual(['C major', 'C major']);
  expect(new Set(score.segments.map((s) => s.chord.key)).size).toBe(1);
  expect(at({ ...frame(), now: 0.6 }, score).previous).toBeUndefined();
});
