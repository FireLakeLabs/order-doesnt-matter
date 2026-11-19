import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { buildFrame, viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import { themes } from '../../src/studio/themes';
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
  visibleColumns,
  heatRamp,
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
  // A loop wrap or playing seek records the next pass, rather than freezing
  // the first lap's spectrum. Paused seeks above have not changed the pass.
  expect(store.pass).toBe(0);
  expect(visibleColumns(store, { from: 0, to: 5 }, 1.005).earlierPass).toBe(true);
  store.observe(f);
  expect(store.pass).toBe(1);
  const next = store.columns.get(COLUMNS_PER_CYCLE)!;
  expect(next).not.toBe(first);
  expect(next.bands[40]).toBe(250);
  expect(visibleColumns(store, { from: 0, to: 5 }, 1.005).earlierPass).toBe(false);
  expect(visibleColumns(store, { from: 0, to: 5 }, 4.01).earlierPass).toBe(true);
  store.observe({ ...f, now: 4 });
  expect(visibleColumns(store, { from: 0, to: 5 }, 4.01).earlierPass).toBe(false);
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
  expect(notes).toHaveLength(60);
  expect(notes.filter((n) => n.hz !== undefined)).toHaveLength(12);
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

test('visible measurements hide future cells, clip the current cell and never fill missing cells', () => {
  const f = { ...scoreFrame(), audio: audio(), now: 1 };
  const store = new HeardColumns();
  store.observe(f);
  store.observe({ ...f, now: 3 });
  const slice = visibleColumns(store, { from: 0.5, to: 4 }, 1.005);
  expect(slice.columns).toHaveLength(1);
  expect(slice.columns[0].from).toBe(1);
  expect(slice.columns[0].to).toBe(1.005);
  expect(slice.columns[0].column.time).toBe(1);
  expect(slice.earlierPass).toBe(true);
  expect(visibleColumns(store, { from: 2, to: 2.5 }, 2.5)).toEqual({
    columns: [],
    earlierPass: false,
  });
  expect(visibleColumns(store, { from: 0, to: 1 }, 0.999)).toEqual({
    columns: [],
    earlierPass: false,
  });
  // The actual sample time, rather than only its cell key, limits visibility.
  const sampled = new HeardColumns();
  sampled.observe({ ...f, now: 1.01 });
  expect(visibleColumns(sampled, { from: 0, to: 2 }, 1.005).columns).toEqual([]);
});

test.each([
  ['arcade', 'rgb(7,6,13)', 'rgb(244,241,255)'],
  ['sunset', 'rgb(26,11,46)', 'rgb(255,233,243)'],
  ['phosphor', 'rgb(2,10,4)', 'rgb(184,255,200)'],
  ['riso', 'rgb(29,27,47)', 'rgb(255,79,123)'],
  ['pocket', 'rgb(15,42,29)', 'rgb(47,93,58)'],
])('%s heat grows brighter without ending in the unmeasured paper colour', (name, quiet, loud) => {
  const ramp = heatRamp(themes[name]);
  expect(ramp[0]).toBe(quiet);
  expect(ramp[255]).toBe(loud);
});

test('log band boundaries match Scope: bins below a band do not inflate its peak', () => {
  const input = audio();
  input.spectrum[12] = 255; // 70.3125 Hz, below the 73.03–78.48 Hz band.
  input.spectrum[13] = 80; // 76.171875 Hz, inside it.
  expect(spectrumBands(input)[18]).toBe(80);
});

test('whole-note fragments count once while genuine coincident onsets remain counted', () => {
  const f = scoreFrame();
  const held = {
    instrument: f.instruments[0].id,
    start: 10,
    end: 12,
    hasOnset: true,
    value: { note: 36 },
  };
  const carried = { ...held, hasOnset: false };
  expect(scoredNotes({ ...f, notes: [held, carried, carried] })).toHaveLength(1);
  expect(scoredNotes({ ...f, notes: [carried, carried] })).toHaveLength(1);
  expect(scoredNotes({ ...f, notes: [held, held, carried] })).toHaveLength(2);
});
