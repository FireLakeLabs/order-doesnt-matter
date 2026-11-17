import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import type { ViewNote } from '../../src/views/types';
import { clamp } from '../../src/views/shared/math';
import { pitch, pitchName, pitchClass, noteName, chordName } from '../../src/views/shared/pitch';
import {
  previousOnset,
  nextOnset,
  noteProgress,
  soundingProgress,
  flightProgress,
} from '../../src/views/shared/timing';
import { settingRanges } from '../../src/views/shared/settings';
import { songSummary } from '../../src/views/shared/song';
import {
  roleEvidence,
  mostRegularDrum,
  lowestPitchedPart,
  drumEvidence,
} from '../../src/views/shared/roles';
import { burst, spark, ash, star, random } from '../../src/views/shared/particles';
import { analyse } from '../../src/views/runner/model';
import { roadVoices } from '../../src/views/night-drive/model';
import { scoreFrame } from './score-fixture';

const note = (
  instrument: string,
  start: number,
  end: number,
  value = {},
  hasOnset = true,
): ViewNote => ({ instrument, start, end, value, hasOnset });
const corpus = new Map<string, { notes: ViewNote[]; ids: string[]; names: string[] }>();
beforeAll(async () => {
  for (const file of ['real-dubstep-arranged', 'piece-kiln']) {
    const source = readFileSync(`corpus/programs/${file}.strudel`, 'utf8');
    const state = loadPiece(initialState(), source, importStrudel(source));
    const to = state.sections.at(-1);
    const end = to ? to.start + to.cycles : 16;
    const entries = await Promise.all(
      state.rows.map(
        async (row) =>
          [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 0, end)] as const,
      ),
    );
    for (const [, result] of entries) expect(result.error).toBeNull();
    corpus.set(file, {
      notes: viewNotes({ from: 0, to: end, events: Object.fromEntries(entries) }),
      ids: state.rows.map((r) => r.id),
      names: state.rows.map((r) => r.name),
    });
  }
});

it('bounds numbers inclusively, with configurable limits', () => {
  expect([-1, 0, 0.4, 1, 2].map((n) => clamp(n))).toEqual([0, 0, 0.4, 1, 1]);
  expect(clamp(4, 5, 10)).toBe(5);
  expect(clamp(20, 5, 10)).toBe(10);
});
describe('pitch contract', () => {
  it('retains all legacy note and frequency forms and precedence, including Rain’s numeric-only frequency policy', () => {
    for (const [raw, want] of [
      [60, 60],
      ['60', 60],
      [' 0 ', 0],
      ['c', 48],
      ['eb1', 27],
      ['G#-1', 8],
      ['cb0', 11],
      ['b#3', 60],
      ['a4', 69],
    ] as const) {
      expect(pitch({ note: raw, n: 99, freq: 880 })).toBe(want);
      expect(pitch({ n: raw }, true)).toBe(want);
    }
    for (const raw of ['', 'x', NaN, Infinity, {}, null])
      expect(pitch({ note: raw, freq: 440 })).toBe(69);
    expect(pitch({ note: 'x', n: 20 })).toBeUndefined();
    expect(pitch({ freq: '440' })).toBe(69);
    expect(pitch({ freq: '440' }, true)).toBeUndefined();
    expect(pitch({ freq: 440 }, true)).toBe(69);
    for (const freq of [0, -1, NaN, Infinity, undefined]) expect(pitch({ freq })).toBeUndefined();
    expect(pitch({})).toBeUndefined();
  });
  it('names pitch classes, octaves, exact triads and sevenths without guessing ambiguous chords', () => {
    expect(pitchClass(-1)).toBe(11);
    expect(pitchClass(60.49)).toBe(0);
    expect(noteName(60)).toBe('C4');
    expect(noteName(-1)).toBe('B-2');
    expect(pitchName(60)).toBe('C-4');
    for (const [pitches, want] of [
      [[60, 64, 67, 72], 'C'],
      [[67, 60, 63], 'Cm'],
      [[60, 64, 67, 70], 'C7'],
      [[60, 64, 67, 71], 'Cmaj7'],
      [[62, 65, 69, 72], 'Dm7'],
      [[60, 63, 66], 'Cdim'],
    ] as const)
      expect(chordName(pitches)).toBe(want);
    for (const pitches of [
      [],
      [60, 64],
      [60, 64, 68],
      [60, 63, 66, 69],
      [60, 61, 67],
      [NaN, 64, 67],
      [60.4, 64, 67],
    ])
      expect(chordName(pitches)).toBeUndefined();
  });
});
it('finds exact inclusive previous and exclusive next onsets in unordered notes, ignoring fragments and other instruments', () => {
  const notes = [note('a', 2, 3), note('a', 0, 1), note('b', 1, 2), note('a', 1, 2, {}, false)];
  expect(previousOnset(notes, 'a', 0)).toBe(notes[1]);
  expect(nextOnset(notes, 'a', 0)).toBe(notes[0]);
  expect(previousOnset(notes, 'a', -1)).toBeUndefined();
  expect(nextOnset(notes, 'a', 2)).toBeUndefined();
  expect(previousOnset([], 'a', 1)).toBeUndefined();
  expect(previousOnset(notes, 'a', 2)).toBe(notes[0]);
});
it('reports sounding progress including fragments, exact ends, overlapping latest-start spans and reversible time', () => {
  const notes = [note('a', 0, 4), note('a', 1, 2, {}, false)];
  expect(soundingProgress(notes, 'a', 1.5)).toBe(0.5);
  expect(soundingProgress(notes, 'a', 2)).toBe(0.5);
  expect(soundingProgress(notes, 'a', 4)).toBeUndefined();
  expect(soundingProgress(notes, 'b', 1)).toBeUndefined();
  expect(noteProgress(notes[1], -1)).toBe(0);
  expect(noteProgress(notes[1], 3)).toBe(1);
  expect(noteProgress(note('a', 1, 1), 1)).toBe(1);
  expect(soundingProgress(notes, 'a', 1.5)).toBe(0.5);
  expect(flightProgress(notes[1], -1, 2)).toBe(0);
  expect(flightProgress(notes[1], 0, 2)).toBe(0.5);
  expect(flightProgress(notes[1], 1, 2)).toBe(1);
  expect(flightProgress(notes[1], 0, 0)).toBe(0);
  expect(flightProgress(notes[1], 1, 0)).toBe(1);
});
it('collects numeric ranges, other value sets and mixed types without mutating notes', () => {
  const notes = [
    note('a', 0, 1, { gain: 0, pan: -1, s: 'bd', mixed: 2 }),
    note('a', 1, 2, { gain: 1, pan: 1, s: 'sd', mixed: 'x', bad: Infinity }),
    note('b', 2, 3, { gain: 0.5, s: 'bd', flag: false }),
  ];
  const before = structuredClone(notes),
    ranges = settingRanges(notes);
  expect(ranges.get('gain')).toEqual({ min: 0, max: 1, values: new Set() });
  expect(ranges.get('s')).toEqual({
    min: undefined,
    max: undefined,
    values: new Set(['bd', 'sd']),
  });
  expect(ranges.get('mixed')).toEqual({ min: 2, max: 2, values: new Set(['x']) });
  expect(ranges.has('bad')).toBe(false);
  expect(notes).toEqual(before);
  expect(settingRanges([]).size).toBe(0);
});
it('summarizes bar-relative note multisets, settings, held spans and silence against the previous bar even for subranges', () => {
  const notes = [
    note('a', 0, 0.5, { gain: 1 }),
    note('a', 1, 1.5, { gain: 1 }),
    note('a', 2, 2.5, { gain: 1 }),
    note('b', 2, 2.5),
  ];
  const bars = songSummary(notes, 0, 5);
  expect(bars.map((b) => b.change)).toEqual([1, 0, 0.5, 1, 0]);
  expect(bars[2].instruments).toEqual(new Set(['a', 'b']));
  expect(songSummary(notes, 1, 3)).toEqual(bars.slice(1, 3));
  expect(songSummary([...notes, note('a', 1, 1.5, { gain: 1 })], 0, 2)[1].change).toBe(0.5);
  expect(
    songSummary([note('a', 0, 0.5, { gain: 1 }), note('a', 1, 1.5, { gain: 2 })], 0, 2)[1].change,
  ).toBe(1);
  expect(songSummary([note('a', 0, 3)], 0, 3).map((b) => b.change)).toEqual([1, 1, 0]);
  expect(songSummary([], 0, 0)).toEqual([]);
  expect(songSummary(notes, 1.4, 1.4)).toEqual([]);
  expect(
    songSummary([note('a', 1 / 3, 2 / 3), note('a', 1 + 1 / 3, 1 + 2 / 3)], 0, 2)[1].change,
  ).toBe(0);
  expect(
    songSummary([note('a', 0, 0.5, { x: 1, y: 2 }), note('a', 1, 1.5, { y: 2, x: 1 })], 0, 2)[1]
      .change,
  ).toBe(0);
});
it('offers distinct regular and sparse drum policies and resolves pitch ties deterministically', () => {
  const notes = [
    note('sparse', 0, 0.1),
    note('sparse', 1, 1.1),
    note('sparse', 1.5, 1.6),
    ...Array.from({ length: 16 }, (_, i) => note('regular', i / 4, i / 4 + 0.1)),
    note('low', 0, 4, { note: 24 }),
    note('high', 0, 4, { note: 60 }),
  ];
  const parts = roleEvidence(notes);
  expect(mostRegularDrum(parts)).toBe('regular');
  expect(mostRegularDrum(parts, 'sparse')).toBe('sparse');
  expect(lowestPitchedPart(parts)).toBe('low');
  expect(lowestPitchedPart(parts, new Set(['high']))).toBe('high');
  expect(mostRegularDrum(parts, 'regular', [])).toBeUndefined();
  expect(lowestPitchedPart(roleEvidence([]))).toBeUndefined();
  expect(drumEvidence(parts.get('high')!)).toBeUndefined();
});
for (const file of ['real-dubstep-arranged', 'piece-kiln'])
  it(`${file}: shared helpers use real corpus notes and preserve view role choices`, () => {
    const { notes, ids, names } = corpus.get(file)!;
    expect(notes.length).toBeGreaterThan(10);
    const evidence = roleEvidence(notes),
      runner = analyse(notes),
      frame = scoreFrame(ids.length);
    frame.notes = notes;
    frame.instruments.forEach((i, index) => {
      i.id = ids[index];
      i.name = 'renamed';
    });
    const road = roadVoices(frame);
    expect([...runner.values()].find((p) => p.role === 'ground')?.id).toBe(
      lowestPitchedPart(evidence),
    );
    expect(road.find((v) => v.role === 'gates')?.instrument.id).toBe(
      mostRegularDrum(evidence, 'regular', ids),
    );
    const choices = {
      sparse: mostRegularDrum(evidence, 'sparse'),
      regular: mostRegularDrum(evidence, 'regular', ids),
      lowest: lowestPitchedPart(evidence),
    };
    const chosenNames = Object.fromEntries(
      Object.entries(choices).map(([role, id]) => [role, names[ids.indexOf(id!)]]),
    );
    expect(chosenNames).toEqual(
      file === 'real-dubstep-arranged'
        ? { sparse: 'dubstepDrums · bd', regular: 'intro · hh', lowest: 'vocalAtmos' }
        : { sparse: 'drums · cp', regular: 'pad', lowest: 'bass' },
    );
    const ranges = settingRanges(notes);
    expect(ranges.size).toBeGreaterThan(2);
    const pitched = notes.find((n) => pitch(n.value) !== undefined)!;
    expect(Number.isFinite(pitch(pitched.value))).toBe(true);
    const onset = notes.find((n) => n.hasOnset)!;
    expect(previousOnset(notes, onset.instrument, onset.start)?.start).toBe(onset.start);
    expect(flightProgress(onset, onset.start, 4)).toBe(1);
    expect(songSummary(notes, 0, 4).every((b) => b.change >= 0 && b.change <= 1)).toBe(true);
  });
it('particles write reusable outputs with finite unit alphas and reproduce time in any call order', () => {
  for (const draw of [burst, spark, ash, star]) {
    const out = { x: 0, y: 0, alpha: 0 };
    const want = { ...draw(17, 0.4, out) };
    expect(draw(17, 0.4, out)).toBe(out);
    for (const t of [100, -100, 0, 0.9]) {
      draw(2, t, out);
      expect(Object.values(out).every(Number.isFinite)).toBe(true);
      expect(out.alpha).toBeGreaterThanOrEqual(0);
      expect(out.alpha).toBeLessThanOrEqual(1);
    }
    expect(draw(17, 0.4, out)).toEqual(want);
    expect(draw(18, 0.4, out)).not.toEqual(want);
  }
  const out = { x: 0, y: 0, alpha: 0 };
  expect(burst(1, -1, out).alpha).toBe(0);
  expect(spark(1, 1, out).alpha).toBe(0);
  expect(random(1)).toBe(random(1));
  expect(random(1)).toBeGreaterThanOrEqual(0);
  expect(random(1)).toBeLessThan(1);
});
