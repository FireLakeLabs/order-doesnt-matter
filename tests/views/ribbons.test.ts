import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, viewNotes } from '../../src/studio/frame';
import type { ViewFrame, ViewNote } from '../../src/views/types';
import {
  cameraPose,
  futureReach,
  gateX,
  indexRibbons,
  noteHeight,
  noteTurn,
  noteWidth,
  pastReach,
  pitchHeight,
  ribbonAt,
  ribbonGeometry,
  ribbonParts,
  timeScale,
} from '../../src/views/ribbons/model';
import { pitch } from '../../src/views/shared/pitch';
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
const only = (note: ViewNote): ViewFrame => ({
  ...frame,
  notes: [note],
  instruments: [{ ...frame.instruments.find((i) => i.id === note.instrument)!, inSection: true }],
});
const partAt = (note: ViewNote) => ribbonParts(only(note))[0];

it('puts the past to the left and the future to the right, with Window setting reach', () => {
  const x = (time: number, window: number) => gateX + ((time - frame.now) / window) * timeScale;
  expect(x(10, 1)).toBeLessThan(gateX);
  expect(x(11, 1)).toBeGreaterThan(gateX);
  expect(x(frame.now, 8)).toBe(gateX);
  expect(x(11, 2) - gateX).toBeCloseTo((x(11, 1) - gateX) / 2);
  expect(pastReach * 8).toBeLessThanOrEqual(4);
  expect(futureReach).toBeGreaterThan(pastReach);
});
it('opens exactly for the scored span and makes gain set the note width', () => {
  const note = frame.notes.find((n) => n.hasOnset && n.start === 10.375)!;
  const part = partAt(note);
  expect(ribbonAt(part, note.start - 0.0001).count).toBe(0);
  expect(ribbonAt(part, note.start).count).toBe(1);
  expect(ribbonAt(part, note.end - 0.0001).count).toBe(1);
  expect(ribbonAt(part, note.end).count).toBe(0);
  expect(noteWidth(part, { ...note, value: { ...note.value, gain: 1 } })).toBe(
    2 * noteWidth(part, { ...note, value: { ...note.value, gain: 0.5 } }),
  );
});
it('keeps a continuous thread through real rests and a completely resting instrument', () => {
  const note = frame.notes.find((n) => n.hasOnset && n.start === 10.5)!;
  const input = only(note),
    part = partAt(note);
  expect(ribbonAt(part, 10.4).count).toBe(0);
  expect(Number.isFinite(ribbonAt(part, 10.4).height)).toBe(true);
  const geometry = ribbonGeometry(input);
  const threadTimes = [];
  for (let i = 0; i < geometry.positions.length / 3; i++)
    if (geometry.marks[i * 3] === 0) threadTimes.push(geometry.positions[i * 3] + input.from);
  expect(Math.min(...threadTimes)).toBe(input.from);
  expect(Math.max(...threadTimes)).toBe(input.to);
  const empty = ribbonGeometry({ ...input, notes: [] });
  expect(empty.threads).toBe(1);
  expect(empty.spans).toBe(0);
  expect(empty.indices.length).toBeGreaterThan(0);
});
it('holds each sampled turn throughout a note and changes it at the next onset without reading instrument names', () => {
  const instrument = frame.instruments.find((i) => i.name === 'wobbleBass')!;
  const note = frame.notes.find(
    (n) => n.instrument === instrument.id && n.hasOnset && n.start === 10,
  )!;
  const part = partAt(note);
  const first = ribbonAt(part, 10.2).turn;
  expect(Math.abs(first)).toBeGreaterThan(0.01);
  expect(ribbonAt(part, 10.8).turn).toBe(first);
  const next = { ...note, start: 11, end: 12, value: { ...note.value, cutoff: 50 } };
  const changed = { ...part, notes: [note, next] };
  expect(ribbonAt(changed, 11 - 0.0001).turn).toBe(first);
  expect(ribbonAt(changed, 11).turn).toBe(noteTurn(next, instrument));
  expect(ribbonAt(changed, 11).turn).not.toBe(first);
  expect(noteTurn(note, { ...instrument, name: 'no role in this name' })).toBe(first);
});
it('sets actual note height from absolute pitch and stacks every unpitched part above pitched notes', () => {
  const parts = ribbonParts(frame);
  const lows = parts.filter((p) => !p.unpitched);
  const drums = parts.filter((p) => p.unpitched);
  expect(drums).toHaveLength(4);
  expect(lows).toHaveLength(2);
  expect(new Set(drums.map((p) => p.baseline)).size).toBe(4);
  for (const part of lows)
    for (const note of part.notes) {
      expect(noteHeight(part, note)).toBe(pitchHeight(pitch(note.value)!));
      expect(noteHeight(part, note)).toBeLessThan(Math.min(...drums.map((p) => p.baseline)));
    }
  expect(pitchHeight(39)).toBeGreaterThan(pitchHeight(27));
  const note = lows[0].notes[0];
  expect(noteHeight(lows[0], note)).toBe(noteHeight({ ...lows[0], notes: [note] }, note));
});
it('shows section members plus notes reaching in from an adjacent section, without naming roles', () => {
  expect(ribbonParts(frame)).toHaveLength(6);
  const boundary = { ...frame, now: 8, instruments: frame.instruments };
  const parts = ribbonParts(boundary);
  expect(parts.length).toBeGreaterThan(6);
  expect(
    parts.some((p) => !p.instrument.inSection && p.notes.some((n) => n.start < 8 && n.end > 7.5)),
  ).toBe(true);
});
it('fans all twenty in depth, retains one full ribbon with one instrument, and keeps depth stable as section membership changes', () => {
  const input = {
    ...frame,
    sections: [],
    instruments: Array.from({ length: 20 }, (_, index) => ({
      ...frame.instruments[index % 13],
      id: String(index),
      index,
    })),
  };
  const parts = ribbonParts(input);
  expect(parts).toHaveLength(20);
  expect(new Set(parts.map((p) => p.depth)).size).toBe(20);
  expect(parts[0].depth).toBeLessThan(parts[19].depth);
  const single = ribbonParts({ ...input, instruments: input.instruments.slice(0, 1) });
  expect(single).toHaveLength(1);
  expect(single[0].depth).toBe(0);
  const changed = ribbonParts({
    ...input,
    sections: [{ name: 'test', from: 0, to: 28 }],
    instruments: input.instruments.map((i, index) => ({ ...i, inSection: index === 10 })),
  });
  expect(changed[0].depth).toBe(parts[10].depth);
});
it('coalesces repeated real eight-cycle carry-ins, while retaining every genuine onset', async () => {
  const states: ReturnType<typeof ribbonAt>[] = [];
  for (const from of [0, 4]) {
    const result = await queryEventsNode('note("c3").slow(8)', from, 13);
    expect(result.error).toBeNull();
    const notes = viewNotes({ from, to: 13, events: { '0': result } });
    const input = { ...scoreFrame(), now: 6, from, to: 13, notes };
    const parts = ribbonParts(input, indexRibbons(notes));
    expect(parts[0].notes.filter((n) => n.start === 0)).toHaveLength(1);
    expect(ribbonGeometry(input, parts).spans).toBe(2);
    states.push(ribbonAt(parts[0], 6));
  }
  expect(states[1]).toEqual(states[0]);
  const note = frame.notes.find((n) => n.hasOnset && n.start === 10 && n.end === 11)!;
  const input = { ...only(note), notes: [note, note] };
  expect(ribbonGeometry(input).spans).toBe(2);
});
it('includes all 500 real note spans and finite thread/strip geometry without a density cutoff', async () => {
  const result = await queryEventsNode('s("hh*500").gain(0.4)', 0, 1);
  expect(result.error).toBeNull();
  const input = {
    ...scoreFrame(),
    now: 0.4,
    from: 0,
    to: 1,
    lookAhead: 1,
    notes: viewNotes({ from: 0, to: 1, events: { '0': result } }),
  };
  const geometry = ribbonGeometry(input);
  expect(geometry.spans).toBe(500);
  expect(geometry.threads).toBe(1);
  expect(geometry.positions.every(Number.isFinite)).toBe(true);
  expect(geometry.edges.every(Number.isFinite)).toBe(true);
  expect(geometry.indices.every((i) => i >= 0 && i < geometry.positions.length / 3)).toBe(true);
});
it('reproduces camera, sampled turns and geometry after arbitrary times and query-order visits', () => {
  const pose = cameraPose(frame.now),
    data = indexRibbons(frame.notes);
  const original = ribbonGeometry(frame, ribbonParts(frame, data));
  for (const now of [0, 19.2, 7.99, 8, 500]) {
    cameraPose(now);
    ribbonGeometry({ ...frame, now }, ribbonParts({ ...frame, now }, data));
  }
  expect(cameraPose(frame.now)).toEqual(pose);
  expect(ribbonGeometry(frame, ribbonParts(frame, data))).toEqual(original);
  expect(cameraPose(frame.now + 1)).not.toEqual(pose);
});
