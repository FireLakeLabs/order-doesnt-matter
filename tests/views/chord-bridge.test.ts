import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import {
  analyse,
  blocks,
  layout,
  nearest,
  pitchLabel,
  stateAt,
  windowAt,
} from '../../src/views/chord-bridge/model';
import type { ViewNote } from '../../src/views/types';
import { scoreFrame } from './score-fixture';
import {
  accidentalStyle,
  bridgeLayout,
  presentation,
  spell,
  stoneBlocks,
} from '../../src/views/chord-bridge/drawing';

let notes: ViewNote[];
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  const entries = await Promise.all(
    state.rows.map(async (row) => {
      const result = await queryEventsNode(generate(state.doc!, { only: row.id }), 12, 28);
      expect(result.error).toBeNull();
      return [row.id, result] as const;
    }),
  );
  notes = viewNotes({ from: 12, to: 28, events: Object.fromEntries(entries) });
});
const frame = () => ({ ...scoreFrame(), now: 17.4, lookAhead: 4, from: 12, to: 28 });
const note = (midi: number, start = 0, instrument = 'p'): ViewNote => ({
  instrument,
  start,
  end: start + 1,
  hasOnset: true,
  value: { note: midi },
});
it('spells the real C-minor material with flats and a sharp-key set with sharps', () => {
  const bridge = analyse(notes);
  expect(presentation(bridge).spelling).toBe('flats');
  expect([44, 51, 60].map((n) => spell(n, presentation(bridge).spelling))).toEqual([
    'A♭2',
    'E♭3',
    'C4',
  ]);
  expect(accidentalStyle([2, 4, 6, 7, 9, 11, 1])).toBe('sharps');
  expect(spell(66, 'sharps')).toBe('F#4');
});
it('fits the whole chord register into the bridge field without rescaling on active siblings', () => {
  const bridge = analyse(notes),
    register = presentation(bridge);
  for (const [width, height] of [
    [1131, 469],
    [560, 674],
    [1300, 760],
  ]) {
    const box = bridgeLayout(width, height, { from: 16, to: 20 }, register);
    const occupied = box.y(41) - box.y(63);
    expect(occupied / (box.bottom - box.top)).toBeGreaterThan(0.8);
    expect(box.y(63)).toBeGreaterThanOrEqual(box.top);
    expect(box.y(41)).toBeLessThanOrEqual(box.bottom);
    for (const lookAhead of [1, 2, 4, 8]) {
      const range = windowAt({ now: 17.9, lookAhead });
      const current = bridgeLayout(width, height, range, register);
      for (const t of [range.from, 17.9, range.to - 0.001]) {
        expect(current.x(t)).toBeGreaterThan(current.left);
        expect(current.x(t)).toBeLessThan(current.right);
      }
    }
    const blocks = bridge.piers.flatMap((p) => stoneBlocks(p, box));
    expect(blocks.reduce((n, b) => n + b.tones.length, 0)).toBe(12);
  }
  const held = { ...note(60), end: 4 };
  const before = presentation(analyse([held, note(61), note(48, 2), note(55, 2)]));
  const after = presentation(analyse([held, note(48, 2), note(55, 2)]));
  expect(before.low).toBe(after.low);
  expect(before.high).toBe(after.high);
});
it('maps the actual breakdown into four piers with the second holding G#2, D#3, C4', () => {
  const bridge = analyse(notes);
  const state = stateAt(bridge, frame());
  expect(state.piers.map((p) => p.start)).toEqual([16, 17, 18, 19]);
  expect(state.piers.map((p) => p.tones.map((t) => t.midi))).toEqual([
    [48, 55, 63],
    [44, 51, 60],
    [41, 48, 56],
    [43, 50, 59],
  ]);
  expect(state.piers[1].tones.map((t) => pitchLabel(t.midi))).toEqual(['G#2', 'D#3', 'C4']);
  expect(state.melody).toHaveLength(16);
  expect(state.melody.filter((t) => t.note.start <= 17.4 && 17.4 < t.note.end)).toHaveLength(0);
  expect(state.others).toHaveLength(1);
  expect([...state.counts.values()]).toEqual([{ total: 1, active: 1 }]);
  expect(nearest(state.piers[0], state.piers[1]).map((l) => l.delta)).toEqual([3, -4, -3]);
  expect(nearest(state.piers[1], state.piers[2]).map((l) => l.delta)).toEqual([-3, -3, -4]);
  expect(nearest(state.piers[2], state.piers[3]).map((l) => l.delta)).toEqual([2, 2, 3]);
  expect(analyse([...notes].reverse()).piers).toEqual(bridge.piers);
});
it('keeps every equally near destination and exact common tones without assigning voices', () => {
  const bridge = analyse([note(60), note(64), note(58, 1), note(62, 1), note(64, 1)]);
  expect(nearest(bridge.piers[0], bridge.piers[1])).toEqual([
    { from: 60, to: 58, delta: -2, tie: true },
    { from: 60, to: 62, delta: 2, tie: true },
    { from: 64, to: 64, delta: 0, tie: false },
  ]);
});
it('uses true fractional starts and preserves fragments, repeated pitches and other-note counts', () => {
  const sample = { ...note(48), instrument: 'sample', value: { n: 0, s: 'bd' } };
  const bridge = analyse([
    note(48, 0.125),
    note(55, 0.125),
    note(48, 0.125),
    { ...note(52, 0.625), hasOnset: false },
    note(59, 0.625),
    sample,
  ]);
  expect(bridge.piers.map((p) => p.start)).toEqual([0.125, 0.625]);
  const f = { ...frame(), now: 0.4, lookAhead: 1 };
  expect(stateAt(bridge, f).others).toEqual([sample]);
  expect(bridge.melody).toBeUndefined();
  const box = layout(1300, 760, { from: 0, to: 1 });
  const dense = blocks(bridge.piers[0].tones, box);
  expect(dense.reduce((n, b) => n + b.tones.length, 0)).toBe(3);
  expect(dense.some((b) => b.label === 'C3 ×2')).toBe(true);
  expect(box.x(0.625) - box.x(0.125)).toBeCloseTo((box.right - box.left) / 3);
});
it('keeps late onsets and the playhead inside the drawing at every Window size', () => {
  for (const lookAhead of [1, 2, 4, 8]) {
    const range = windowAt({ now: 17.9, lookAhead });
    for (const width of [560, 1300]) {
      const box = layout(width, 760, range);
      for (const t of [range.from, range.from + 0.125, 17.9, range.to - 0.001]) {
        expect(box.x(t)).toBeGreaterThanOrEqual(box.left);
        expect(box.x(t)).toBeLessThanOrEqual(box.right);
      }
    }
  }
});
it('counts degenerate pitched spans in the side strip instead of making a role or dropping them', () => {
  const bad = [0, -1].map((duration) => ({ ...note(60, 1), end: 1 + duration }));
  const bridge = analyse(bad);
  expect(bridge.chord).toBeUndefined();
  expect(bridge.melody).toBeUndefined();
  const state = stateAt(bridge, { ...frame(), now: 1.4 });
  expect(state.others).toHaveLength(2);
  expect([...state.counts.values()]).toEqual([{ total: 2, active: 0 }]);
});
it('counts a held span once across continuation copies, while retaining real unison onsets', () => {
  const held = { ...note(48), end: 4 };
  const continuation = { ...held, hasOnset: false, value: { note: 48, lpf: 1200 } };
  const withOnset = analyse([held, held, continuation, continuation]);
  expect(withOnset.notes).toHaveLength(2);
  expect(withOnset.tones).toHaveLength(2);
  const carried = analyse([continuation, continuation]);
  expect(carried.notes).toHaveLength(1);
  expect(carried.tones).toHaveLength(1);
});
it('counts dense and out-of-range pitches in bounded blocks; no chord or melody is invented', () => {
  const bridge = analyse(Array.from({ length: 500 }, (_, i) => note(i % 140)));
  for (const [width, height] of [
    [1300, 760],
    [560, 470],
  ]) {
    const box = layout(width, height, { from: 0, to: 4 });
    const dense = blocks(bridge.piers[0].tones, box);
    expect(dense.reduce((n, b) => n + b.tones.length, 0)).toBe(500);
    expect(dense.length).toBeLessThanOrEqual(Math.ceil((box.bottom - box.top) / 24) + 1);
    expect(dense.some((b) => b.label.includes('edge'))).toBe(true);
  }
  const single = analyse([note(60)]);
  expect(single.chord).toBeUndefined();
  expect(single.melody).toBe('p');
  expect(analyse([]).piers).toEqual([]);
});
