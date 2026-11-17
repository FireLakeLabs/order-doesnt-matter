import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import {
  analyse,
  comparison,
  layout,
  strip,
  voiceCount,
  lanes,
  differenceLabel,
  isDense,
} from '../../src/views/deja-vu/model';
import { songSummary } from '../../src/views/shared/song';
import { scoreFrame } from './score-fixture';
import type { ViewFrame, ViewNote } from '../../src/views/types';
let real: ViewFrame;
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
  real = buildFrame({ ...scoreFrame(), state, score, notes: viewNotes(score) });
});
const note = (start: number, midi = 48, value: Record<string, unknown> = {}): ViewNote => ({
  instrument: '0',
  start,
  end: start + 0.125,
  hasOnset: true,
  value: { note: midi, ...value },
});
function compare(notes: ViewNote[], now = 1.4) {
  const f = { ...scoreFrame(), now, notes };
  return comparison(f, analyse(notes));
}
it('matches exact pitches first, pairs one leftover pitch change, and refuses ambiguous leftovers', () => {
  const unambiguous = compare([note(0, 48), note(0, 52), note(1, 55), note(1, 52)]);
  expect(voiceCount(unambiguous.rows[0].entries)).toBe(2);
  expect(unambiguous.counts).toEqual({ same: 1, changed: 1, new: 0, vanished: 0 });
  expect(unambiguous.rows[0].entries.find((e) => e.kind === 'changed')!.differences).toEqual([
    { key: 'pitch', before: 48, after: 55 },
  ]);
  const ambiguous = compare([
    note(0, 48),
    note(0, 52),
    note(0, 60),
    note(1, 55),
    note(1, 57),
    note(1, 60),
  ]);
  expect(ambiguous.counts).toEqual({ same: 1, changed: 0, new: 2, vanished: 2 });
});
it('matches note multisets, retaining identical unison voices before settings changes', () => {
  const result = compare([
    note(0, 48, { gain: 0.2 }),
    note(0, 48, { gain: 0.8 }),
    note(1, 48, { gain: 0.8 }),
    note(1, 48, { gain: 0.6 }),
  ]);
  expect(result.counts).toEqual({ same: 1, changed: 1, new: 0, vanished: 0 });
  expect(result.rows[0].entries.find((e) => e.kind === 'changed')!.differences).toEqual([
    { key: 'gain', before: 0.2, after: 0.6 },
  ]);
  expect(compare([note(0), note(0), note(1)]).counts).toEqual({
    same: 1,
    changed: 0,
    new: 0,
    vanished: 1,
  });
});
it('matches cycle-relative times at fraction precision and settings by content', () => {
  const notes = [
    note(1 / 3, 48, { envelope: { a: 1, b: 2 } }),
    note(1 + 1 / 3, 48, { envelope: { b: 2, a: 1 } }),
  ];
  expect(compare(notes).counts.same).toBe(1);
  expect(compare([note(0), note(1.25)]).counts).toEqual({
    same: 0,
    changed: 0,
    new: 1,
    vanished: 1,
  });
  const separate = [note(0), { ...note(1), instrument: '1' }];
  const f = { ...scoreFrame(2), now: 1.4, notes: separate };
  expect(comparison(f, analyse(separate)).counts).toEqual({
    same: 0,
    changed: 0,
    new: 1,
    vanished: 1,
  });
});
it('clips held notes to each compared bar without inventing a new onset', () => {
  const held = { ...note(0), end: 3 };
  const score = analyse([held]);
  expect(score.bars.get(1)![0].onset).toBe(false);
  expect(comparison({ ...scoreFrame(), now: 2.4, notes: [held] }, score).counts).toEqual({
    same: 1,
    changed: 0,
    new: 0,
    vanished: 0,
  });
  const fragment = { ...held, hasOnset: false };
  expect(compare([fragment]).rows[0].entries[0].differences).toEqual([]);
});
it('hatches unknown bars and predecessors rather than inventing silence', () => {
  const f = {
    ...scoreFrame(),
    now: 10.4,
    from: 10,
    to: 12,
    sections: [{ name: 'song', from: 0, to: 28 }],
    notes: [note(10)],
  };
  const score = analyse(f.notes),
    result = comparison(f, score),
    cells = strip(f, score);
  expect(result.known).toBe(false);
  expect(result.currentKnown).toBe(true);
  expect(result.counts.new).toBe(0);
  expect(result.change).toBeUndefined();
  expect(result.rows[0].entries[0].kind).toBe('unasked');
  expect(cells).toHaveLength(28);
  expect(cells[10].change).toBeUndefined();
  expect(cells[11].change).toBe(1);
  expect(cells[12].change).toBeUndefined();
  const loop = strip({ ...f, now: 38.4, from: 28, to: 56 }, analyse([]));
  expect(loop[0]).toEqual({ bar: 28, change: undefined });
  expect(loop[10]).toEqual({ bar: 38, change: 0 });
});
it('uses shared song change scores on the real corpus, including disappearance into silence', () => {
  const score = analyse(real.notes),
    expected = songSummary(real.notes, 0, 28);
  expect(strip(real, score).map((s) => s.change)).toEqual(expected.map((s) => s.change));
  for (const now of [10.4, 8.4]) {
    const result = comparison({ ...real, now }, score);
    console.log(
      'Déjà vu real comparison:',
      JSON.stringify({
        now,
        change: result.change,
        counts: result.counts,
        rows: result.rows
          .filter((r) => r.entries.length)
          .map((r) => ({
            name: r.instrument.name,
            counts: r.entries.reduce(
              (a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }),
              {} as Record<string, number>,
            ),
          })),
      }),
    );
    expect(result.change).toBe(expected[Math.floor(now)].change);
    expect(result.counts).toEqual(
      now === 10.4
        ? { new: 3, vanished: 4, changed: 9, same: 4 }
        : { new: 15, vanished: 13, changed: 0, same: 0 },
    );
    const current = score.bars.get(Math.floor(now))!.length,
      previous = score.bars.get(Math.floor(now) - 1)!.length;
    expect(result.counts.same + result.counts.changed + result.counts.new).toBe(current);
    expect(result.counts.same + result.counts.changed + result.counts.vanished).toBe(previous);
  }
  expect(comparison({ ...real, now: 8.4 }, score).counts.new).toBeGreaterThan(0);
  const sparse = analyse([note(0)]);
  expect(strip({ ...scoreFrame(), now: 0.4 }, sparse)[1].change).toBe(1);
});
it('retains all 500 notes, all twenty instruments, and derives the same result in any time order', () => {
  const f = {
    ...scoreFrame(20),
    now: 1.4,
    notes: Array.from({ length: 20 }, (_, i) =>
      Array.from({ length: 500 }, (_, j) => ({
        ...note(1 + j / 500, 48),
        end: 1 + (j + 1) / 500,
        instrument: String(i),
      })),
    ).flat(),
  };
  const score = analyse(f.notes),
    result = comparison(f, score);
  expect(result.rows).toHaveLength(20);
  expect(result.counts.new).toBe(10000);
  expect(result.rows.every((r) => r.entries.length === 500)).toBe(true);
  comparison({ ...f, now: 2 }, score);
  comparison({ ...f, now: 0 }, score);
  expect(comparison(f, score)).toEqual(result);
  const corpus = analyse(real.notes),
    first = comparison(real, corpus);
  comparison({ ...real, now: 17.4 }, corpus);
  expect(comparison(real, corpus)).toEqual(first);
});
it('sizes six main note rows from the mockup and keeps Stage B type readable', () => {
  for (const size of [
    { width: 1300, height: 760 },
    { width: 1131.25, height: 469.09375 },
    { width: 560, height: 760 },
    { width: 560, height: 675 },
  ]) {
    const g = layout(size, 6);
    expect(g.noteHeight).toBeGreaterThanOrEqual((28 * size.width) / 960);
    expect(g.font).toBeGreaterThanOrEqual(12);
    expect(g.rowHeight).toBeGreaterThan(g.noteHeight);
    expect(size.height - g.bottom).toBeLessThan(size.height / 4);
  }
  expect(layout({ width: 560, height: 760 }, 20).noteHeight).toBeGreaterThan(12);
});

it('keeps sequential and changed pitches at one voice, and still detects non-pitch sample settings', () => {
  const changed = compare([note(0, 48, { n: 0 }), note(1, 51, { n: 1 })]);
  expect(voiceCount(changed.rows[0].entries)).toBe(1);
  expect(changed.rows[0].entries[0].differences.map((d) => d.key)).toEqual(['pitch', 'n']);
  const sequential = compare([note(0, 48), note(0.5, 52), note(1, 48), note(1.5, 52)]);
  expect(voiceCount(sequential.rows[0].entries)).toBe(1);
});

it('gives simultaneous equal-pitch voices distinct lanes and keeps small changes legible', () => {
  const result = compare([
    note(0, 48, { gain: 0.5001 }),
    note(0, 48, { gain: 0.8 }),
    note(1, 48, { gain: 0.5002 }),
    note(1, 48, { gain: 0.8 }),
  ]);
  const entries = result.rows[0].entries,
    positions = lanes(entries);
  expect(new Set(entries.map((e) => positions.get(e.after!))).size).toBe(2);
  expect(new Set(entries.map((e) => positions.get(e.before!))).size).toBe(2);
  const d = entries.find((e) => e.kind === 'changed')!.differences[0];
  expect(differenceLabel(d)).toEqual({ key: 'gain', before: '0.5001', after: '0.5002' });
});

it('preserves sub-semitone changes before formatting pitch names', () => {
  for (const notes of [
    [note(0, 48), note(1, 48.3)],
    [
      { ...note(0), value: { freq: 440 } },
      { ...note(1), value: { freq: 441 } },
    ],
  ]) {
    const result = compare(notes),
      d = result.rows[0].entries[0].differences.find((d) => d.key === 'pitch')!;
    expect(result.counts.changed).toBe(1);
    expect(typeof d.before).toBe('number');
    const label = differenceLabel(d);
    expect(label.before).not.toBe(label.after);
  }
  expect(differenceLabel({ key: 'pitch', before: 48, after: 55 })).toEqual({
    key: 'pitch',
    before: 'C3',
    after: 'G3',
  });
});
it('distinguishes an unasked current bar from an unasked predecessor', () => {
  const f = { ...scoreFrame(), now: 28.4, from: 28, to: 56, notes: [] };
  expect(comparison(f, analyse([]))).toMatchObject({ known: false, currentKnown: true });
  expect(comparison({ ...f, from: 0, to: 28 }, analyse([]))).toMatchObject({
    known: false,
    currentKnown: false,
  });
});
it.each(['entry spacing', 'row height', 'voices', 'annotation fit'])(
  'uses the %s density boundary without dropping real-corpus entries',
  (threshold) => {
    const row = comparison(real, analyse(real.notes)).rows.find(
      (r) => r.instrument.name === 'hh · drop',
    )!;
    const base = {
      count: row.entries.length,
      width: row.entries.length * 20,
      rowHeight: 40,
      voices: 1,
      annotationHeight: 22,
    };
    expect(isDense(base)).toBe(false);
    const crowded =
      threshold === 'entry spacing'
        ? { ...base, width: base.width - 0.1 }
        : threshold === 'row height'
          ? { ...base, rowHeight: 29.9, annotationHeight: 0 }
          : threshold === 'voices'
            ? { ...base, voices: 5, annotationHeight: 0 }
            : { ...base, annotationHeight: 22.1 };
    expect(isDense(crowded)).toBe(true);
    expect(row.entries).toHaveLength(8);
    if (threshold === 'row height')
      expect(isDense({ ...base, rowHeight: 30, annotationHeight: 0 })).toBe(false);
    if (threshold === 'voices')
      expect(isDense({ ...base, voices: 4, annotationHeight: 0 })).toBe(false);
  },
);
