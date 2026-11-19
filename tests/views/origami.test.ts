import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { expect, test, vi } from 'vitest';
import { importStrudel } from '../../src/import';
import { instruments } from '../../src/document';
import { createStructureCache } from '../../src/studio/program-structure';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  answerBook,
  answerReason,
  contextLabels,
  focusPart,
  noteIdentity,
  paperWindow,
  printMarks,
  sealedReason,
  snapshotNotes,
  stepLabel,
  visibleSteps,
} from '../../src/views/origami/model';
import type { ViewSnapshot } from '../../src/views/types';

const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
const empty: ViewSnapshot = {
  status: 'available',
  result: { events: [], cps: 0.5, error: null, opaqueValues: false },
};
test('bar 11: eight real stages preserve five notes; fast is on the sine branch only', async () => {
  const doc = importStrudel(source).doc,
    rows = instruments(doc),
    bass = rows.find((r) => r.name === 'wobbleBass')!;
  const cache = createStructureCache({ query: queryEventsNode, cancel() {} });
  const structure = cache.forFrame(doc, { from: 0, to: 28 }).get(bass.id)!;
  expect(structure.steps.map(stepLabel)).toEqual([
    'phrase',
    'cutoff',
    'gain',
    'hcutoff',
    'resonance',
    'room',
    's',
    'shape',
  ]);
  const snapshots = await Promise.all(structure.steps.map((_, i) => structure.snapshot(i)));
  const notes = snapshots.map((s) => snapshotNotes(s, 8, 12));
  expect(notes.map((n) => n.length)).toEqual(Array(8).fill(5));
  expect(notes[0].map((n) => n.value.note)).toEqual(['c2', 'c2', 'eb2', 'f2', 'g2']);
  expect(notes.map(noteIdentity)).toEqual(Array(8).fill(noteIdentity(notes[0])));
  expect(notes.at(-1)![2].value).toMatchObject({
    note: 'eb2',
    s: 'sawtooth',
    resonance: 11,
    shape: 0.65,
    hcutoff: 110,
    room: 0.25,
    gain: 0.75,
  });
  expect(notes.at(-1)![2].value.cutoff).toBeCloseTo(1370);
  expect(notes.at(-1)!.reduce((n, e) => n + (e.fragments ?? 1), 0)).toBe(17);
  const filter = structure.steps[1];
  if (filter.kind !== 'setting') throw Error('missing filter');
  expect(filter.driver.kind).toBe('signal');
  expect(filter.driver.rates).toHaveLength(1);
  const rates = snapshotNotes(await filter.driver.rates[0].events(), 8, 12);
  expect(rates.map((n) => n.value.value)).toEqual([2, 4, 3, 8]);
  expect(contextLabels(structure)).toEqual(['use 1: placement', 'use 2: placement']);
  cache.dispose();
});
test('focus uses chain length among the actual current section, never a name or mute', () => {
  const frame = scoreFrame(3);
  frame.sections = [
    { name: 'a', from: 0, to: 8 },
    { name: 'b', from: 8, to: 16 },
  ];
  frame.notes = frame.instruments.map((i, n) => ({
    instrument: i.id,
    start: n === 2 ? 0 : 8,
    end: n === 2 ? 1 : 12,
    hasOnset: true,
    value: { note: 'c2' },
  }));
  frame.structure = {
    get(id) {
      return { steps: Array(Number(id) === 2 ? 20 : Number(id) + 2) } as never;
    },
  };
  expect(focusPart(frame)).toBe('1');
  expect(
    focusPart({
      ...frame,
      instruments: frame.instruments.map((i) => ({ ...i, name: 'renamed', muted: true })),
    }),
  ).toBe('1');
  expect(focusPart(frame, '0')).toBe('0');
  expect(focusPart(frame, 'missing')).toBe('1');
  expect(paperWindow(frame)).toMatchObject({ from: 8, to: 12 });
  expect(paperWindow({ ...frame, now: 26.4 })).toMatchObject({ from: 24, to: 28, offset: 16 });
  expect(visibleSteps(8, 0)).toEqual([7]);
  expect(visibleSteps(8, 1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});
test('rewrites compare actual queried notes; callback prefixes stay sealed and query errors stay broken', async () => {
  const doc = importStrudel('note("c3 e3").rev().fast(2).gain(.2)').doc;
  const cache = createStructureCache({ query: queryEventsNode, cancel() {} });
  const s = cache.forFrame(doc, { from: 0, to: 4 }).get(instruments(doc)[0].id)!;
  const notes = await Promise.all(
    s.steps.map(async (_, i) => snapshotNotes(await s.snapshot(i), 0, 4)),
  );
  expect(noteIdentity(notes[1])).not.toBe(noteIdentity(notes[0]));
  expect(notes[2]).toHaveLength(16);
  expect(noteIdentity(notes[3])).toBe(noteIdentity(notes[2]));
  const callback = importStrudel(
    readFileSync('corpus/programs/micro-callback-deep.strudel', 'utf8'),
  ).doc;
  const opaque = cache.forFrame(callback, { from: 0, to: 4 }).get(instruments(callback)[0].id)!;
  expect(sealedReason(opaque, 2)).toContain('Callback');
  expect(answerReason(await opaque.snapshot(2))).toContain('Callback');
  const failed: ViewSnapshot = {
    ...empty,
    status: 'available',
    result: { ...empty.result, error: { phase: 'query', message: 'broken' } },
  };
  expect(snapshotNotes(failed, 0, 4)).toEqual([]);
  expect(answerReason(failed)).toBe('broken');
  cache.dispose();
});
test('answers are lazy, serial, shared over frames and inert after disposal', async () => {
  const doc = importStrudel('note("c3").s("sine")').doc;
  const cache = createStructureCache({ query: queryEventsNode, cancel() {} }),
    s = cache.forFrame(doc, { from: 0, to: 4 }).get(instruments(doc)[0].id)!;
  const book = answerBook(),
    resolve: { value?: (v: ViewSnapshot) => void } = {};
  const first = vi.fn(
    () =>
      new Promise<ViewSnapshot>((r) => {
        resolve.value = r;
      }),
  );
  const second = vi.fn(async () => empty);
  expect(first).not.toHaveBeenCalled();
  expect(book.read(s, '0', first)).toBeUndefined();
  book.read(s, '0', first);
  book.read(s, '1', second);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  resolve.value!(empty);
  await setImmediate();
  expect(book.read(s, '0', first)).toBe(empty);
  book.read(s, '1', second);
  expect(second).toHaveBeenCalledTimes(1);
  book.dispose();
  await setImmediate();
  book.read(s, '2', first);
  expect(first).toHaveBeenCalledTimes(1);
  cache.dispose();
});
test('fixed bins preserve 2000 notes as counted bundles and a held note keeps its slot', () => {
  const held = { start: 8, end: 12, onset: true, value: { note: 'c2' } };
  const crowded = Array.from({ length: 2000 }, (_, i) => ({
    ...held,
    start: 8 + i / 500,
    end: 8 + (i + 1) / 500,
  }));
  for (const width of [40, 110, 150]) {
    const marks = printMarks(crowded, 8, 12, width);
    expect(marks.reduce((sum, n) => sum + n.count, 0)).toBe(2000);
    expect(marks.length).toBeLessThan(30);
  }
  const slot = printMarks([held], 8, 12, 140)[0];
  expect(printMarks([held, { ...held, start: 10, value: { note: 'eb2' } }], 8, 12, 140)[0]).toEqual(
    slot,
  );
});

test('touching control continuations merge without losing simultaneous notes or changed values', () => {
  const events = [
    {
      whole: [0, 1] as [number, number],
      part: [0, 0.5] as [number, number],
      hasOnset: true,
      value: { note: 'c2', gain: 0.5 },
    },
    {
      whole: [0, 1] as [number, number],
      part: [0, 0.5] as [number, number],
      hasOnset: true,
      value: { note: 'c2', gain: 0.5 },
    },
    {
      whole: [0, 1] as [number, number],
      part: [0.5, 1] as [number, number],
      hasOnset: false,
      value: { note: 'c2', gain: 0.5 },
    },
    {
      whole: [0, 1] as [number, number],
      part: [0.5, 1] as [number, number],
      hasOnset: false,
      value: { note: 'c2', gain: 0.5 },
    },
  ];
  const answer: ViewSnapshot = { status: 'available', result: { ...empty.result, events } };
  const merged = snapshotNotes(answer, 0, 4);
  expect(merged).toHaveLength(2);
  expect(merged.map((n) => n.fragments)).toEqual([2, 2]);
  expect(
    snapshotNotes(
      { ...answer, result: { ...answer.result, events: events.slice().reverse() } },
      0,
      4,
    ),
  ).toEqual(merged);
  events[3].value.gain = 0.75;
  expect(snapshotNotes(answer, 0, 4)).toHaveLength(3);
});

test('pitch survives an added sound, while replacing a drum phrase changes its printed identity', () => {
  const note = { start: 0, end: 1, onset: true, value: { note: 'c2' } };
  expect(noteIdentity([note])).toBe(
    noteIdentity([{ ...note, value: { note: 'c2', s: 'sawtooth' } }]),
  );
  expect(noteIdentity([{ ...note, value: { s: 'bd' } }])).not.toBe(
    noteIdentity([{ ...note, value: { s: 'hh' } }]),
  );
});
