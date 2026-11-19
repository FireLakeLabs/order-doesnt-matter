import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { buildFrame, viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  BANDS,
  COLUMNS_PER_CYCLE,
  HeardColumns,
  MAX_COLUMNS,
  decibels,
  frequency,
  frequencyPosition,
  level,
  noteGeometry,
  scoredNotes,
  spectrumBands,
} from '../../src/views/afterglow/model';

const audio = () => ({ wave: new Float32Array(4800), spectrum: new Uint8Array(4096) });

test('log FFT bands and dB range use actual tap bins, not score settings', () => {
  const input = audio();
  input.spectrum[Math.round(1000 / (48000 / 8192))] = 219;
  const bands = spectrumBands(input);
  expect(bands).toHaveLength(BANDS);
  const band = Math.floor((Math.log(1000 / 20) / Math.log(1000)) * BANDS);
  expect(bands[band]).toBe(219);
  expect(bands[band - 2]).toBe(0);
  expect(bands[band + 2]).toBe(0);
  expect(decibels(0)).toBe(-100);
  expect(decibels(255)).toBe(-30);
  expect(level(0)).toBe(0);
  expect(level(255)).toBe(1);
  expect(frequencyPosition(20)).toBe(0);
  expect(frequencyPosition(20000)).toBe(1);
  expect(frequencyPosition(200)).toBeCloseTo(1 / 3);
});

test('observation history copies first measurements, keeps seeks missing, ignores paused tap data and is bounded', () => {
  const f = { ...scoreFrame(), audio: audio(), now: 1 };
  const store = new HeardColumns();
  f.audio.spectrum.fill(100);
  store.observe(f);
  const first = store.columns.get(COLUMNS_PER_CYCLE)!;
  f.audio.spectrum.fill(250);
  store.observe(f);
  expect(first.bands[40]).toBe(100);
  store.observe({ ...f, now: 4 });
  expect(store.columns.size).toBe(2);
  expect(store.columns.has(2 * COLUMNS_PER_CYCLE)).toBe(false);
  store.observe({ ...f, now: 2, playing: false });
  store.observe({ ...f, now: 2, audio: undefined });
  expect(store.columns.size).toBe(2);
  store.observe(f);
  expect(store.columns.get(COLUMNS_PER_CYCLE)).toBe(first);
  for (let i = 0; i < MAX_COLUMNS + 5; i++) store.observe({ ...f, now: 5 + i / COLUMNS_PER_CYCLE });
  expect(store.columns.size).toBe(MAX_COLUMNS);
  expect(store.columns.has(COLUMNS_PER_CYCLE)).toBe(false);
  store.clear();
  expect(store.columns.size).toBe(0);
});

test('host per-document facts clear history for a replacement document even with identical settings', () => {
  const source = 'note("c2").s("sine")';
  const state = loadPiece(initialState(), source, importStrudel(source));
  const frame = (doc = state.doc) =>
    buildFrame({
      state: { ...state, doc },
      score: { from: 0, to: 4, events: {} },
      notes: [],
      now: 1,
      cps: 0.5,
      playing: true,
      theme: scoreFrame().theme,
      lookAhead: 4,
      trails: 1,
      width: 1300,
      height: 760,
      dpr: 1,
      audio: audio(),
    });
  const store = new HeardColumns();
  const f = frame();
  store.observe(f);
  store.observe({ ...frame(), now: 2, width: 560, theme: { ...f.theme, name: 'riso' } });
  expect(store.columns.size).toBe(2);
  const replacement = frame(structuredClone(state.doc));
  expect(replacement.instruments[0].settings).toEqual(f.instruments[0].settings);
  store.observe({ ...replacement, playing: false });
  expect(store.columns.size).toBe(0);
});

test('real dubstep outlines keep actual spans and floor samples, and are pure across backwards seeks', async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  const results = await Promise.all(
    state.rows.map(
      async (row) =>
        [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 4, 16)] as const,
    ),
  );
  results.forEach(([, result]) => expect(result.error).toBeNull());
  const f = {
    ...scoreFrame(state.rows.length),
    now: 10.4,
    lookAhead: 4,
    notes: viewNotes({ from: 4, to: 16, events: Object.fromEntries(results) }),
  };
  f.instruments.forEach((i, n) => {
    i.id = state.rows[n].id;
    i.name = 'renamed';
  });
  const notes = scoredNotes(f);
  expect(notes).toHaveLength(69);
  expect(notes.filter((n) => n.hz !== undefined)).toHaveLength(21);
  expect(notes.filter((n) => n.hz === undefined)).toHaveLength(48);
  const wobble = notes.find((n) => n.note.value.s === 'sawtooth' && n.note.start === 10)!;
  expect(wobble.hz).toBeCloseTo(frequency(39));
  expect(wobble.note.end).toBe(11);
  expect(notes.filter((n) => n.note.value.s === 'hh').every((n) => n.hz === undefined)).toBe(true);
  const before = notes.map(({ note, hz }) => noteGeometry(note, hz, f));
  scoredNotes({ ...f, now: 20, width: 560 });
  scoredNotes({ ...f, now: 1 });
  expect(scoredNotes(f).map(({ note, hz }) => noteGeometry(note, hz, f))).toEqual(before);
  const lone = { ...f, notes: [wobble.note] };
  expect(noteGeometry(wobble.note, wobble.hz, lone)).toEqual(
    noteGeometry(wobble.note, wobble.hz, f),
  );
});
