import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { instrumentFacts } from '../../src/studio/view-instruments';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  padLayout,
  padState,
  sampleCursor,
  samplePads,
  waveformPeaks,
} from '../../src/views/sampler/model';
import type { SampleBuffer } from '../../src/strudel/sample-buffers';
import type { ViewNote } from '../../src/views/types';

const buffer: SampleBuffer = {
  status: 'buffer',
  sampleRate: 48000,
  duration: 2,
  frameCount: 96000,
  url: 'real.wav',
  fileName: 'real.wav',
  // Drawing must never touch raw PCM, even on the first frame.
  get channels(): readonly Float32Array[] {
    throw Error('Raw PCM was scanned');
  },
  peaks: {
    blockSize: 48000,
    channels: [
      { min: new Float32Array([-0.7, -0.2]), max: new Float32Array([0.4, 0.8]) },
      { min: new Float32Array([-0.8, -0.1]), max: new Float32Array([0.1, 0.6]) },
    ],
  },
};
const note = (value: ViewNote['value'] = {}, start = 10): ViewNote => ({
  instrument: '0',
  start,
  end: start + 0.125,
  hasOnset: true,
  value: { s: 'bd', ...value },
});
it('places source cursors from onset seconds, sample rate, slice and signed speed, independently of score length', () => {
  const n = note({ begin: 0.25, end: 0.75, speed: 2 });
  const c = sampleCursor(n, buffer, 10.125, 0.5);
  expect(c.fraction).toBe(0.5);
  expect(c.position).toBe(0.5);
  expect(c.ended).toBe(false);
  expect(sampleCursor(n, buffer, 11, 0.5)).toMatchObject({
    position: 0.75,
    fraction: 1,
    ended: true,
  });
  const reverse = sampleCursor(note({ begin: 0.1, end: 0.4, speed: -1 }), buffer, 10.1, 0.5);
  expect(reverse.begin).toBe(0.6);
  expect(reverse.end).toBe(0.9);
  expect(reverse.position).toBeCloseTo(0.8);
  expect(reverse.fraction).toBeCloseTo(1 / 3);
  expect(sampleCursor(note({ speed: 0 }), buffer, 11, 0.5).ended).toBe(true);
  expect(sampleCursor(note({ unit: 'c' }), buffer, 10.25, 0.5).fraction).toBe(0.5);
  expect(sampleCursor(note({ unit: 's' }), buffer, 10.25, 0.5).fraction).toBe(0.25);
  expect(sampleCursor(note({ note: 'c3' }), buffer, 10.1, 0.5).limited).toBe(true);
});
it('uses only peak summaries, combines all channels, and shares a bounded screen summary', () => {
  const peaks = waveformPeaks(buffer, 2);
  expect([...peaks.min]).toEqual([...new Float32Array([-0.8, -0.2])]);
  expect([...peaks.max]).toEqual([...new Float32Array([0.4, 0.8])]);
  expect(waveformPeaks(buffer, 2)).toBe(peaks);
});
it('counts every overlapping retrigger, excludes fragments/future onsets, and suppresses resting/muted lights', () => {
  const frame = scoreFrame();
  frame.cps = 0.5;
  frame.samples = { get: () => buffer };
  frame.notes = [
    ...Array.from({ length: 500 }, (_, i) => note({}, 10 + i / 10000)),
    { ...note(), end: 11, hasOnset: false },
    note({}, 11),
  ];
  const pad = samplePads(frame)[0];
  expect(padState(pad, frame).active).toHaveLength(500);
  frame.instruments[0].inSection = false;
  expect(padState(pad, frame)).toMatchObject({ light: 0, active: [], resting: true });
  frame.instruments[0].inSection = true;
  frame.instruments[0].muted = true;
  expect(padState(pad, frame).active).toHaveLength(0);
});
it('keeps addresses and ordering independent of now and note order, retains other-section constants and labels missing sounds', () => {
  const frame = scoreFrame(3);
  frame.instruments[1].settings = [
    { name: 's', label: 'Sound', kind: 'constant', value: 'speech' },
    { name: 'n', label: 'Index', kind: 'constant', value: 2 },
  ];
  frame.instruments[1].inSection = false;
  frame.notes = [note({ n: 2, bank: 'tr' }), note({ n: 0 })];
  const pads = samplePads(frame);
  expect(samplePads({ ...frame, notes: [{ ...note(), value: {} }] })[0].result.status).toBe(
    'unavailable',
  );
  expect(pads.map((p) => [p.sound, p.index, p.result.status])).toEqual([
    ['bd', 0, 'loading'],
    ['tr_bd', 2, 'loading'],
    ['speech', 2, 'loading'],
  ]);
  expect(
    samplePads({ ...frame, now: 0, notes: frame.notes.slice().reverse() }).map((p) => p.key),
  ).toEqual(pads.map((p) => p.key));
  expect(padLayout(1, 1300, 760, 0).columns).toBe(1);
  for (const width of [560, 1300]) {
    const layout = padLayout(500, width, 760, 30);
    expect(layout.capacity).toBeLessThan(500);
    expect(layout.width).toBeGreaterThan(200);
  }
});
it('maps the real dubstep window and the real slice program, with synths classified only by the lookup', async () => {
  for (const file of ['real-dubstep-arranged', 'real-custom-samples']) {
    const source = readFileSync(`corpus/programs/${file}.strudel`, 'utf8');
    const state = loadPiece(initialState(), source, importStrudel(source));
    const frame = scoreFrame(state.rows.length);
    const facts = instrumentFacts(state.doc);
    const entries = await Promise.all(
      state.rows.map(
        async (row) =>
          [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 4, 22)] as const,
      ),
    );
    for (const [, result] of entries) expect(result.error).toBeNull();
    frame.notes = viewNotes({ from: 4, to: 22, events: Object.fromEntries(entries) });
    frame.instruments.forEach((part, i) => {
      part.id = state.rows[i].id;
      part.name = state.rows[i].name;
      Object.assign(part, facts.get(part.id));
    });
    // Classification here substitutes only the sound registry, not scored values.
    frame.samples = {
      get: (s) =>
        ['sine', 'sawtooth', 'supersaw', 'triangle'].includes(s) ? { status: 'synth' } : buffer,
    };
    const pads = samplePads(frame);
    if (file === 'real-dubstep-arranged') {
      expect(
        pads
          .filter((p) => p.result.status === 'synth')
          .map((p) => p.sound)
          .sort(),
      ).toEqual(['sawtooth', 'sine', 'supersaw', 'triangle']);
      expect(
        pads
          .filter((p) => p.result.status === 'buffer')
          .map((p) => `${p.sound}:${p.index}`)
          .sort(),
      ).toEqual(['ade:0', 'bd:0', 'hh:0', 'oh:0', 'sd:0', 'speech:2']);
    } else {
      expect(pads).toHaveLength(1);
      expect(new Set(pads[0].notes.map((n) => n.value.begin)).size).toBe(7);
      expect(
        pads[0].notes.every(
          (n) => n.value.speed === 1.1 && Number(n.value.end) - Number(n.value.begin) === 0.125,
        ),
      ).toBe(true);
    }
  }
});
