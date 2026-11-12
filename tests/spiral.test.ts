import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { spiralMarks, opacityAt, laneGeometry } from '../src/spiral/model';
import { liveModel, turnNotes, type TurnNote, type LiveInput } from '../src/live/model';
import { importStrudel } from '../src/import';
import { instruments, sections } from '../src/document';
import { generate } from '../src/generate';
import type { EventResult } from '../src/contract';
import { queryEventsNode } from './node-query';
import { createApp } from '../src/app/controller';
const worker = vi.hoisted(() => ({
  pools: 0,
  jobs: [] as { code: string; from: number; to: number; resolve: (r: EventResult) => void }[],
  cancels: 0,
}));
vi.mock('../src/strudel/evaluate-browser', () => ({
  createBrowserQueries: () => {
    const watch = worker.pools++ % 3 === 2;
    return {
      query: (code: string, from: number, to: number) =>
        watch
          ? new Promise<EventResult>((resolve) => worker.jobs.push({ code, from, to, resolve }))
          : queryEventsNode(code, from, to),
      cancel() {
        if (watch) worker.cancels++;
      },
    };
  },
}));
const lanes = ['a', 'b'];
const size = { width: 1440, height: 900 };
const note = (from = 0, to = 0.25): TurnNote => ({
  instrument: 'a',
  cycle: 0,
  from,
  to,
  label: 'c3',
});
it('keeps the playing turn full, two upcoming turns visible, and fades continuously after passing', () => {
  for (let d = -3; d <= 3; d += 1 / 60) {
    expect(Math.abs(opacityAt(d) - opacityAt(d + 1 / 60))).toBeLessThanOrEqual(0.05);
    if (d >= -1 && d <= 0) expect(opacityAt(d)).toBe(1);
    if (d >= 0 && d <= 2) expect(opacityAt(d)).toBeGreaterThanOrEqual(0.4);
  }
  expect(opacityAt(-1.75)).toBeGreaterThan(0);
  expect(opacityAt(-2)).toBe(0);
  const notes = Array.from({ length: 5 }, (_, cycle) => ({ ...note(), cycle }));
  for (let now = 0; now < 4; now += 1 / 60) {
    const a = spiralMarks(notes, lanes, now, size),
      b = spiralMarks(notes, lanes, now + 1 / 60, size);
    for (const mark of a)
      expect(Math.abs(mark.opacity - b.find((m) => m.id === mark.id)!.opacity)).toBeLessThanOrEqual(
        0.05,
      );
  }
});
it('splits crossing spans once at the seam, retaining true unequal lengths and multiplicity', () => {
  const marks = spiralMarks([note(0.75, 1.5), note(0, 0.125), note(0, 0.125)], lanes, 0.9, size);
  expect(marks.map((m) => m.to - m.from)).toEqual([0.25, 0.5, 0.125, 0.125]);
  expect(marks[0].endAngle).toBeCloseTo(marks[1].startAngle);
  expect(marks[0].endRadius).toBeCloseTo(marks[1].radius);
  expect(marks.filter((m) => m.onset)).toHaveLength(3);
  expect(new Set(marks.map((m) => m.id)).size).toBe(4);
  expect(
    (marks[1].endAngle - marks[1].startAngle) / (marks[2].endAngle - marks[2].startAngle),
  ).toBeCloseTo(4);
});
for (const count of [1, 6, 30])
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ])
    it(`${count} lanes do not overlap at ${size.width}×${size.height}`, () => {
      const g = laneGeometry(count, size);
      expect(g.width).toBeGreaterThan(0);
      expect(g.width).toBeLessThan(g.spacing);
      expect(count * g.spacing).toBeLessThan(g.pitch);
      const marks = spiralMarks(
        Array.from({ length: count }, (_, n) => ({ ...note(), instrument: String(n) })),
        Array.from({ length: count }, (_, n) => String(n)),
        0,
        size,
      );
      for (let n = 1; n < count; n++)
        expect(marks[n].radius - marks[n - 1].radius).toBeGreaterThan(g.width);
      expect(marks.at(-1)!.endRadius).toBeLessThan(Math.min(size.width, size.height) / 2);
    });
it('512 starts become exactly 64 occupancy bins, never an assumed note grid below the threshold', () => {
  const marks = spiralMarks(
    Array.from({ length: 512 }, (_, n) => note(n / 512, (n + 1) / 512)),
    lanes,
    0,
    size,
  );
  expect(marks).toHaveLength(64);
  expect(marks.every((m) => m.dense)).toBe(true);
  expect(
    spiralMarks(
      Array.from({ length: 128 }, (_, n) => note(n / 128, (n + 1) / 128)),
      lanes,
      0,
      size,
    ),
  ).toHaveLength(128);
});
it('real-house-arranged: eight worker cycles account for every start and every touched turn exactly once', async () => {
  const doc = importStrudel(
    readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'),
  ).doc;
  const rows = instruments(doc);
  const events: Record<string, EventResult> = Object.fromEntries(
    await Promise.all(
      rows.map(async (r) => [r.id, await queryEventsNode(generate(doc, { only: r.id }), 0, 8)]),
    ),
  );
  const input: LiveInput = {
    rows,
    sections: sections(doc),
    events,
    sounds: [],
    solo: null,
    playhead: 0,
    fromCycle: 0,
    toCycle: 8,
  };
  const notes = turnNotes(input, 0, 8),
    marks = spiralMarks(
      notes,
      rows.map((r) => r.id),
      0,
      size,
    );
  expect(marks.filter((m) => m.onset)).toHaveLength(
    Object.values(events).flatMap((r) =>
      r.events.filter((e) => e.whole && e.part[0] === e.whole[0]),
    ).length,
  );
  for (const n of notes)
    for (let turn = n.cycle; turn < Math.ceil(n.cycle + n.to); turn++)
      expect(
        marks.filter(
          (m) =>
            m.instrument === n.instrument &&
            m.start === n.cycle + n.from &&
            m.turn === turn &&
            m.label === n.label,
        ),
      ).toHaveLength(1);
  expect(liveModel(input).instruments).toHaveLength(rows.length);
});

it('Watch reuses held events, batches missing cycles no more than every four, and rejects answers after close', async () => {
  worker.jobs = [];
  worker.pools = 0;
  const app = createApp();
  await app.load('s("sawtooth*8")');
  await vi.waitFor(() => expect(Object.keys(app.state.events)).toHaveLength(1));
  app.follow(false);
  app.setWatch(true);
  const input = app.watchInput(4);
  expect(input.known).toEqual([[0, 4]]);
  expect(worker.jobs.map((j) => [j.from, j.to])).toEqual([[4, 12]]);
  for (const cycle of [4.5, 5, 7.99]) app.watchInput(cycle);
  expect(worker.jobs).toHaveLength(1);
  const answer = await queryEventsNode(worker.jobs[0].code, 4, 12);
  worker.jobs[0].resolve(answer);
  await vi.waitFor(() => expect(app.watchInput(4).known).toContainEqual([4, 12]));
  expect(turnNotes(app.watchInput(4), 3, 8)).toHaveLength(40);
  app.watchInput(9);
  expect(worker.jobs).toHaveLength(2);
  app.setWatch(false);
  worker.jobs[1].resolve(answer);
  await Promise.resolve();
  await Promise.resolve();
  expect(app.watchInput(9).known).toEqual([[0, 4]]);
  expect(worker.cancels).toBeGreaterThan(0);
});
it('Watch recovers muted score spans for hollow drawing without changing the stored document', async () => {
  worker.jobs = [];
  worker.pools = 0;
  const app = createApp();
  await app.load('_$: s("sawtooth*8")');
  await vi.waitFor(() => expect(Object.keys(app.state.events)).toHaveLength(1));
  const doc = JSON.stringify(app.state.doc);
  app.setWatch(true);
  app.watchInput(0);
  expect(worker.jobs).toHaveLength(1);
  const j = worker.jobs[0];
  j.resolve(await queryEventsNode(j.code, j.from, j.to));
  await vi.waitFor(() => expect(turnNotes(app.watchInput(0), 0, 3)).toHaveLength(24));
  expect(liveModel(app.watchInput(0)).instruments[0].silenced).toBe(true);
  expect(JSON.stringify(app.state.doc)).toBe(doc);
  app.setWatch(false);
});

it('a long scored tail continues when its onset leaves the held window', async () => {
  worker.jobs = [];
  worker.pools = 0;
  const app = createApp();
  await app.load('s("sawtooth").slow(4)');
  await vi.waitFor(() => expect(Object.keys(app.state.events)).toHaveLength(1));
  app.setWatch(true);
  const current = app.watchInput(2.5);
  expect(
    turnNotes(current, -Infinity, 6).some((n) => n.cycle + n.from === 0 && n.cycle + n.to === 4),
  ).toBe(true);
  app.watchInput(5);
  for (const j of worker.jobs) j.resolve(await queryEventsNode(j.code, j.from, j.to));
  await vi.waitFor(() => expect(app.watchInput(5).known.length).toBeGreaterThan(1));
  const notes = turnNotes(app.watchInput(5), -Infinity, 8);
  expect(notes.some((n) => n.cycle + n.from === 4 && n.cycle + n.to === 8)).toBe(true);
  app.setWatch(false);
});

it('arranged boundaries say end while the next pass still follows real absolute questions; failures stay broken', async () => {
  worker.jobs = [];
  worker.pools = 0;
  const app = createApp();
  await app.load('arrange([2,s("sawtooth")],[2,s("triangle")])');
  await vi.waitFor(() => expect(Object.keys(app.state.events)).toHaveLength(2));
  app.setWatch(true);
  expect(app.watchInput(3.5).end).toBe(4);
  const input = app.watchInput(5);
  expect(input.end).toBe(8);
  for (const j of worker.jobs)
    j.resolve({
      events: [],
      cps: 1,
      opaqueValues: false,
      error: { message: 'Late question failed', phase: 'query' },
    });
  await vi.waitFor(() =>
    expect(
      liveModel(app.watchInput(5)).instruments.some((i) => i.error === 'Late question failed'),
    ).toBe(true),
  );
  app.setWatch(false);
});

it('the brief negative scheduling origin cannot pin the first future turn out of the Watch cache', async () => {
  worker.jobs = [];
  worker.pools = 0;
  const app = createApp();
  await app.load('s("sawtooth*8")');
  await vi.waitFor(() => expect(Object.keys(app.state.events)).toHaveLength(1));
  app.setWatch(true);
  app.watchInput(-0.02);
  expect(turnNotes(app.watchInput(1.5), 3, 4)).toHaveLength(8);
  app.setWatch(false);
});
