import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { instruments, sections } from '../src/document';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { liveModel, turnNotes, type LiveInput } from '../src/live/model';
import type { EventResult } from '../src/contract';
import { queryEventsNode } from './node-query';

const doc = importStrudel('stack(s("bd"), s("hh"), s("cp"))').doc;
const rows = instruments(doc);
const event = (start: number, end: number, value: unknown = { s: 'bd' }, onset = true) => ({
  whole: [start, end] as [number, number],
  part: [onset ? start : start + 0.1, end] as [number, number],
  value,
  hasOnset: onset,
});
const result = (events: EventResult['events']): EventResult => ({
  events,
  cps: 1,
  error: null,
  opaqueValues: false,
});
const input = (): LiveInput => ({
  rows,
  sections: [],
  events: {},
  sounds: [],
  solo: null,
  playhead: 0,
  fromCycle: 0,
  toCycle: 4,
});
it('uses whole onset boundaries, excludes fragments and signals, keeps empty and broken rows', () => {
  const i = input();
  i.events = {
    [rows[0].id]: result([
      event(1, 1.2),
      event(0, 0.7),
      event(-1, 2, {}, false),
      { ...event(0, 1), whole: null },
    ]),
    [rows[1].id]: result([]),
    [rows[2].id]: { ...result([]), error: { message: 'Question failed', phase: 'query' } },
  };
  const a = liveModel({ ...i, playhead: 0.9 }).instruments;
  expect([a[0].lastOnset, a[0].nextOnset]).toEqual([0, 1]);
  expect(liveModel({ ...i, playhead: 1 }).instruments[0].lastOnset).toBe(1);
  expect(liveModel({ ...i, playhead: -0.5 }).instruments[0].lastOnset).toBeNull();
  expect(a[1]).toMatchObject({ lastOnset: null, nextOnset: null, inSection: false, sound: 'none' });
  expect(a[2].error).toBe('Question failed');
  expect(a.map((r) => r.colour)).toEqual([0, 1, 2]);
  expect(a[0].sound).toBe('not-loaded');
  expect(liveModel({ ...i, sounds: [{ name: 'bd', state: 'missing' }] }).instruments[0].sound).toBe(
    'missing',
  );
  expect(liveModel({ ...i, solo: rows[0].id }).instruments.map((r) => r.silenced)).toEqual([
    false,
    true,
    true,
  ]);
  expect(liveModel({ ...i, rows: [{ ...rows[0], muted: true }] }).instruments[0].silenced).toBe(
    true,
  );
});
it('groups top-level sends, default room, varying sends and conflicting settings; ignores private FX', () => {
  const i = input();
  i.events = {
    [rows[0].id]: result([
      event(0, 1, { room: 0.4, roomsize: 1 }),
      event(1, 2, { room: 0.4, roomsize: 1 }),
    ]),
    [rows[1].id]: result([
      event(0, 1, { room: 0.4, roomsize: 2, delay: 0.25 }),
      event(1, 2, { delay: 0.5 }),
      event(2, 3, { orbit: 2, room: 1 }),
    ]),
    [rows[2].id]: result([event(0, 1, { FX: { room: 1, delay: 1 } })]),
  };
  const m = liveModel(i);
  expect(m.rooms).toEqual([
    {
      orbit: 1,
      members: [rows[0].id, rows[1].id],
      reverb: 'varies',
      delay: 'varies',
      conflict: true,
    },
  ]);
  expect(m.instruments[2].room).toBeNull();
  i.events = {
    [rows[0].id]: result([
      event(0, 1, { orbit: 2, delay: 0.2, delaytime: 0.1, delayfeedback: 0.5 }),
    ]),
    [rows[1].id]: result([
      event(0, 1, { orbit: 2, delay: 0.2, delaytime: 0.2, delayfeedback: 0.5 }),
    ]),
  };
  expect(liveModel(i).rooms[0]).toMatchObject({ orbit: 2, reverb: 0, delay: 0.2, conflict: true });
});
it('compares effective delay settings, including pinned defaults and explicit time precedence', () => {
  const i = input();
  i.events = {
    [rows[0].id]: result([event(0, 1, { delay: 0.2 })]),
    [rows[1].id]: result([
      event(0, 1, { delay: 0.2, delaytime: 3 / 16, delaysync: 99, delayfeedback: 0.5 }),
    ]),
  };
  expect(liveModel(i).rooms[0].conflict).toBe(false);
});
it('uses the containing absolute section at boundaries without repeating cached events', () => {
  const i = input();
  i.sections = [
    { id: 'a', name: 'A', nameSource: 'author', start: 0, cycles: 2, instrumentIds: [rows[0].id] },
    { id: 'b', name: 'B', nameSource: 'author', start: 2, cycles: 2, instrumentIds: [rows[1].id] },
  ];
  i.events = {
    [rows[0].id]: result([event(0, 3, { room: 0.4 })]),
    [rows[1].id]: result([event(2, 3, { room: 0.4, orbit: 2 })]),
  };
  expect(liveModel({ ...i, playhead: 1.99 }).instruments.map((r) => r.inSection)).toEqual([
    true,
    false,
    false,
  ]);
  const at = liveModel({ ...i, playhead: 2 });
  expect(at.instruments.map((r) => r.inSection)).toEqual([false, true, false]);
  expect(at.rooms.map((r) => r.orbit)).toEqual([2]);
  expect(liveModel({ ...i, playhead: 4 }).instruments.every((r) => !r.inSection)).toBe(true);
});
it('turn notes retain unequal spans and crossing tails without drawing fragments twice', () => {
  const i = input();
  i.events = {
    [rows[0].id]: result([
      event(0.75, 1.5, { note: 'c3' }),
      event(1, 1.1, { s: 'bd' }),
      event(0.75, 1.5, {}, false),
    ]),
  };
  expect(turnNotes(i, 0, 1)).toEqual([
    { instrument: rows[0].id, cycle: 0, from: 0.75, to: 1.5, label: 'c3' },
  ]);
  expect(turnNotes(i, 1, 2)[0]).toMatchObject({ cycle: 1, from: 0, to: expect.closeTo(0.1) });
});
for (const name of ['piece-kiln', 'real-house-arranged'])
  it(`${name}: eight cycles agree with worker onsets, section participation, rooms and solo`, async () => {
    const doc = importStrudel(readFileSync(`corpus/programs/${name}.strudel`, 'utf8')).doc;
    const rows = instruments(doc);
    const events: Record<string, EventResult> = Object.fromEntries(
      await Promise.all(
        rows.map(async (r) => [r.id, await queryEventsNode(generate(doc, { only: r.id }), 0, 8)]),
      ),
    );
    const i = { ...input(), rows, sections: sections(doc), events, toCycle: 8 };
    for (const row of rows) {
      expect(events[row.id].error).toBeNull();
      const starts = [
        ...new Set(
          events[row.id].events
            .filter((e) => e.whole && e.part[0] === e.whole[0])
            .map((e) => e.whole![0]),
        ),
      ].sort((a, b) => a - b);
      const reported = starts.map(
        (cycle) =>
          liveModel({ ...i, playhead: cycle }).instruments.find((r) => r.id === row.id)!.lastOnset,
      );
      expect(reported).toEqual(starts);
      expect(
        [
          ...new Set(
            turnNotes(i, 0, 8)
              .filter((n) => n.instrument === row.id)
              .map((n) => n.cycle + n.from),
          ),
        ].sort((a, b) => a - b),
      ).toEqual(starts);
    }
    for (const cycle of [0, 4, 7.99]) {
      const m = liveModel({ ...i, playhead: cycle, solo: rows[0].id });
      const part = i.sections.find((s) => cycle >= s.start && cycle < s.start + s.cycles)!;
      for (const row of m.instruments) {
        expect(row.inSection).toBe(
          events[row.id].events.some(
            (e) =>
              e.whole &&
              e.part[0] === e.whole[0] &&
              e.whole[0] >= part.start &&
              e.whole[0] < part.start + part.cycles,
          ),
        );
        expect(row.silenced).toBe(
          row.id !== rows[0].id || rows.find((r) => r.id === row.id)!.muted,
        );
      }
      expect(
        [
          ...m.rooms.flatMap((r) => r.members),
          ...m.instruments.filter((r) => r.room === null).map((r) => r.id),
        ].sort(),
      ).toEqual(rows.map((r) => r.id).sort());
    }
  });
it('1,000 frame models for 30 instruments and 2,000 events take less than 100 ms', () => {
  const i = input();
  i.rows = Array.from({ length: 30 }, (_, n) => ({ ...rows[0], id: String(n) }));
  i.events = Object.fromEntries(
    i.rows.map((r, n) => [
      r.id,
      result(
        Array.from({ length: n < 20 ? 67 : 66 }, (_, j) =>
          event(j / 20, j / 20 + 0.03, { s: 'bd', room: 0.4 }),
        ),
      ),
    ]),
  );
  const start = performance.now();
  for (let n = 0; n < 1000; n++) liveModel({ ...i, playhead: n / 250 });
  const ms = performance.now() - start;
  console.log(`liveModel 1,000 frames: ${ms.toFixed(2)} ms`);
  expect(ms).toBeLessThan(100);
});
