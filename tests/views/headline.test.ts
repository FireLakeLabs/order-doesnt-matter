import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, viewNotes } from '../../src/studio/frame';
import type { ViewFrame, ViewNote } from '../../src/views/types';
import { fitWord, indexWords, poster, sectionAt, wordState } from '../../src/views/headline/model';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';

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
  const score = { from: 0, to: 28, events: Object.fromEntries(entries) };
  frame = buildFrame({
    ...scoreFrame(),
    state,
    score,
    notes: viewNotes(score),
    lookAhead: 1,
  });
});
const only = (note: ViewNote, now: number): ViewFrame => ({
  ...frame,
  now,
  instruments: [{ ...frame.instruments.find((i) => i.id === note.instrument)!, inSection: true }],
  notes: [note],
});
const wordAt = (note: ViewNote, now: number) => poster(only(note, now)).words[0];

it('keeps the current section in row order, outlines its rests, and names every instrument sitting out', () => {
  const scene = poster({ ...frame, instruments: [...frame.instruments].reverse() });
  const members = frame.instruments.filter((i) => i.inSection);
  expect(scene.words.map((w) => w.instrument.id)).toEqual(members.map((i) => i.id));
  expect(scene.words.map((w) => w.text)).toEqual(members.map((i) => i.name.toUpperCase()));
  expect(scene.words).toHaveLength(6);
  expect(scene.sitOut.map((i) => i.name)).toEqual(
    frame.instruments.filter((i) => !i.inSection).map((i) => i.name),
  );
  expect(scene.sitOut).toHaveLength(7);
  expect(scene.section.name).toBe('drop');
  expect(scene.words.some((w) => !w.solid)).toBe(true);
  expect(poster({ ...frame, sections: [] }).words).toHaveLength(13);
  expect(poster({ ...frame, sections: [] }).sitOut).toHaveLength(0);
});
it('punches on real onsets, remains solid for the scored span, and is hollow at rest even when paused', () => {
  const note = frame.notes.find((n) => n.hasOnset && n.start === 10.375)!;
  expect(note).toBeDefined();
  expect(wordAt(note, note.start - 0.001).solid).toBe(false);
  expect(wordAt(note, note.start).punch).toBeGreaterThan(0);
  expect(wordAt(note, note.start).solid).toBe(true);
  const paused = poster({ ...only(note, note.start + 0.01), playing: false }).words[0];
  expect(paused.solid).toBe(true);
  expect(paused.punch).toBeLessThan(wordAt(note, note.start).punch);
  expect(wordAt(note, note.end).solid).toBe(false);
  expect(
    poster({
      ...only(note, note.start),
      instruments: [{ ...frame.instruments.find((i) => i.id === note.instrument)!, muted: true }],
    }).words[0].solid,
  ).toBe(false);
});
it('stretches a held word as it holds, maps gain to weight, and retains that width change when fitted', () => {
  const note = frame.notes.find((n) => n.hasOnset && n.start === 10 && n.end === 11)!;
  const early = wordAt(note, 10.2),
    late = wordAt(note, 10.8);
  expect(late.stretch).toBeGreaterThan(early.stretch);
  expect(fitWord(late, 900, 80).scaleX).toBeGreaterThan(fitWord(early, 900, 80).scaleX);
  expect(wordAt({ ...note, value: { ...note.value, gain: 0.2 } }, 10.4).weight).toBeLessThan(
    wordAt({ ...note, value: { ...note.value, gain: 1.2 } }, 10.4).weight,
  );
  expect(wordAt({ ...note, value: { ...note.value, gain: 0.2 } }, 10).punch).toBe(
    wordAt({ ...note, value: { ...note.value, gain: 1.2 } }, 10).punch,
  );
});
it('reads a moving setting from the real sampled bag, resets slant at onset, and does not depend on query extrema', () => {
  const instrument = frame.instruments.find((i) => i.name === 'wobbleBass')!;
  const note = frame.notes.find(
    (n) => n.instrument === instrument.id && n.hasOnset && n.start === 10,
  )!;
  expect(note).toBeDefined();
  expect(wordAt(note, 10).slant).toBe(0);
  const slant = wordAt(note, 10.4).slant;
  expect(Math.abs(slant)).toBeGreaterThan(0.01);
  expect(wordAt(note, 10.8).slant).toBe(slant);
  const current = poster(frame).words.find((w) => w.instrument.id === instrument.id)!;
  expect(current.slant).toBe(slant);
  expect(wordAt({ ...note, value: { ...note.value, cutoff: 50 } }, 10.4).slant).not.toBe(slant);
  const renamed = { ...instrument, name: 'A name with no musical role' };
  expect(wordState(frame, renamed, [note]).slant).toBe(slant);
});
it('resets the poster at a section boundary and wraps named sections through subsequent song loops', () => {
  const note = frame.notes.find((n) => n.hasOnset && n.end - n.start >= 1)!;
  const boundary = note.start + 0.5;
  const split = {
    ...only(note, boundary),
    sections: [
      { name: 'before', from: 0, to: boundary },
      { name: 'after', from: boundary, to: note.end + 1 },
    ],
  };
  const word = poster(split).words[0];
  expect(word.progress).toBe(0);
  expect(word.slant).toBe(0);
  expect(word.punch).toBe(0);
  expect(poster(split).section.name).toBe('after');
  expect(sectionAt({ ...frame, now: 38.4 })).toEqual({ name: 'drop', from: 36, to: 44 });
});
it('reduces Pocket to weight and outline, with no punch, stretch or slant', () => {
  const pocket = poster({ ...frame, theme: { ...frame.theme, name: 'pocket' } });
  expect(pocket.words.some((w) => w.solid)).toBe(true);
  expect(pocket.words.some((w) => !w.solid)).toBe(true);
  for (const word of pocket.words) {
    expect([word.punch, word.stretch, word.slant]).toEqual([0, 1, 0]);
    expect(word.motion).toBe(false);
  }
  expect(new Set(pocket.words.map((w) => w.weight)).size).toBeGreaterThan(1);
});
it('fills the stage with one instrument, and gives all twenty instruments two columns on both stages', () => {
  const single = poster({ ...frame, sections: [], instruments: frame.instruments.slice(0, 1) });
  expect(single.words[0].fontSize).toBeGreaterThan(frame.height * 0.65);
  for (const width of [1300, 560]) {
    const twenty = poster({
      ...frame,
      width,
      instruments: Array.from({ length: 20 }, (_, index) => ({
        ...frame.instruments[index % 13],
        id: String(index),
        index,
        inSection: true,
      })),
    });
    expect(twenty.columns).toBe(2);
    expect(twenty.words).toHaveLength(20);
    for (const word of twenty.words) {
      expect(word.x).toBeGreaterThan(0);
      expect(word.x + word.width).toBeLessThan(width);
      expect(word.y + word.height).toBeLessThan(frame.height);
      expect(word.fontSize).toBeGreaterThan(60);
    }
  }
});
it('coalesces real multi-cycle carry-ins without multiplying weight or losing genuine unison voices', async () => {
  const scenes: ReturnType<typeof poster>['words'] = [];
  for (const from of [0, 4]) {
    const result = await queryEventsNode('note("c3").slow(8).gain(0.5)', from, 13);
    expect(result.error).toBeNull();
    const notes = viewNotes({ from, to: 13, events: { '0': result } });
    if (from === 4) expect(notes.filter((n) => n.start === 0)).toHaveLength(4);
    const input = { ...scoreFrame(), from, to: 13, now: 6, notes };
    scenes.push(poster(input).words[0]);
  }
  expect(scenes[0].active).toBe(1);
  expect(scenes[1].active).toBe(1);
  expect(scenes[1].weight).toBe(scenes[0].weight);
  expect(scenes[1].stretch).toBe(scenes[0].stretch);
  const original = frame.notes.find((n) => n.hasOnset && n.start === 10 && n.end === 11)!;
  expect(poster({ ...only(original, 10.4), notes: [original, original] }).words[0].active).toBe(2);
});
it('accounts for every onset in a real 500-note cycle by accumulating hits into the word', async () => {
  const result = await queryEventsNode('s("hh*500").gain(0.4)', 0, 1);
  expect(result.error).toBeNull();
  const notes = viewNotes({ from: 0, to: 1, events: { '0': result } });
  expect(notes.filter((n) => n.hasOnset)).toHaveLength(500);
  const input = { ...scoreFrame(), from: 0, to: 1, notes, now: 0.4 };
  const word = poster(input).words[0];
  expect(word.active).toBe(1);
  expect(word.hits).toBe(
    notes.filter((n) => n.start <= input.now && n.start > input.now - input.cps * 0.18).length,
  );
  expect(word.hits).toBeGreaterThan(40);
  expect(word.punch).toBe(0.16);
  expect(Object.values(fitWord(word, 300, 80)).every(Number.isFinite)).toBe(true);
});
it('draws the same model after arbitrary scrubs and ignores duplicate fragments within the question', () => {
  const data = indexWords(frame.notes);
  const expected = poster(frame, data);
  for (const now of [25.7, 2.1, 0, 8, 11.5]) poster({ ...frame, now }, data);
  expect(poster(frame, data)).toEqual(expected);
  expect(
    poster({ ...frame, notes: [...frame.notes, ...frame.notes.filter((n) => !n.hasOnset)] }),
  ).toEqual(expected);
});
