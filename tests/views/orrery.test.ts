import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  alignment,
  commonPeriod,
  indexOrrery,
  orbitMarks,
  orbitPhase,
  orreryLayout,
  periodText,
  rational,
} from '../../src/views/orrery/model';
import type { ViewFrame, ViewNote } from '../../src/views/types';

const corpus = new Map<string, ViewFrame>();
beforeAll(async () => {
  for (const file of ['real-dubstep-arranged', 'real-techno']) {
    const source = readFileSync(`corpus/programs/${file}.strudel`, 'utf8');
    const state = loadPiece(initialState(), source, importStrudel(source));
    const f = scoreFrame(state.rows.length);
    f.sections = state.sections.map((s) => ({
      name: s.name,
      from: s.start,
      to: s.start + s.cycles,
    }));
    f.to = f.sections.at(-1)?.to ?? 16;
    const entries = await Promise.all(
      state.rows.map(
        async (row) =>
          [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 0, f.to)] as const,
      ),
    );
    for (const [, result] of entries) expect(result.error).toBeNull();
    f.notes = viewNotes({ from: 0, to: f.to, events: Object.fromEntries(entries) });
    f.instruments.forEach((i, n) => {
      i.id = state.rows[n].id;
      i.name = state.rows[n].name;
    });
    corpus.set(file, f);
  }
});
const note = (start: number, end: number, value: ViewNote['value'] = { note: 'c3' }): ViewNote => ({
  instrument: '0',
  start,
  end,
  value,
  hasOnset: true,
});
it('recovers rational timings and computes rational LCM without rounding to bars', () => {
  expect(rational(1 / 3)).toEqual({ n: 1, d: 3 });
  expect(rational(Math.sqrt(2))).toBeNull();
  expect(
    commonPeriod([
      { n: 2, d: 3 },
      { n: 4, d: 5 },
    ]),
  ).toEqual({ n: 4, d: 1 });
  expect(
    commonPeriod([
      { n: 1, d: 3 },
      { n: 1, d: 2 },
    ]),
  ).toEqual({ n: 1, d: 1 });
  expect(
    commonPeriod([
      { n: 2, d: 3 },
      { n: 4, d: 3 },
    ]),
  ).toEqual({ n: 4, d: 3 });
  expect(orbitPhase({ n: 2, d: 3 }, 1)).toBeCloseTo(0.5);
  expect(alignment({ n: 4, d: 3 }, 1)).toMatchObject({ next: 4 / 3, flash: 0 });
  expect(alignment({ n: 4, d: 3 }, 4 / 3)?.flash).toBeCloseTo(1);
});
it('infers sub-bar and multi-bar patterns with rests, chords and multiplicity', () => {
  const f = scoreFrame();
  f.to = 4;
  f.notes = Array.from({ length: 6 }, (_, i) => note((i * 2) / 3, (i * 2) / 3 + 1 / 3));
  expect(indexOrrery(f).orbits[0].period).toEqual({ n: 2, d: 3 });
  expect(indexOrrery(f).common).toEqual({ n: 2, d: 3 });
  f.notes = f.notes.flatMap((n) => [
    n,
    { ...n, value: { note: 'e3' } },
    { ...n, value: { note: 'e3' } },
  ]);
  const o = indexOrrery(f).orbits[0];
  expect(o.period).toEqual({ n: 2, d: 3 });
  expect(o.marks).toEqual([{ phase: 0, count: 3 }]);
  f.notes[5] = { ...f.notes[5], value: { note: 'g3' } };
  expect(indexOrrery(f).orbits[0].period).toBeNull();
});
it('refuses one-shot, empty, random, fragment, clipped, opaque or unrecoverable evidence', () => {
  const f = scoreFrame();
  f.to = 4;
  for (const notes of [
    [],
    [note(0, 1)],
    [note(0, 1), note(1, 2, { note: 'd3' }), note(2, 3, { note: 'e3' })],
    [{ ...note(0, 1), hasOnset: false }],
    [note(-1, 1)],
    [note(0, Math.sqrt(2))],
    [note(0, 1, { note: () => 1 }), note(1, 2)],
    [note(0, 1, { value: 2n }), note(1, 2, { value: 2n })],
  ]) {
    expect(indexOrrery({ ...f, notes }).orbits[0].period).toBeNull();
  }
});
it('finds the real Dubstep periods from notes, independently of names, settings and now', () => {
  const f = corpus.get('real-dubstep-arranged')!;
  const q = indexOrrery(f);
  const mapping = q.orbits.map((o) => ({
    name: f.instruments.find((i) => i.id === o.id)!.name,
    period: periodText(o.period),
    observed: o.observed,
    lap: o.marks.reduce((n, m) => n + m.count, 0),
    reason: o.reason,
  }));
  console.log('Orrery Dubstep:', JSON.stringify(mapping));
  expect(q.orbits).toHaveLength(f.instruments.length);
  expect(mapping.map((o) => [o.name, o.period, o.lap])).toEqual([
    ['darkPad', '4', 12],
    ['vocalAtmos', '4', 1],
    ['intro · hh', '1/4', 1],
    ['buildSection · sd', '1/8', 1],
    ['buildSection · sawtooth', '1', 1],
    ['preDropVocal', 'unknown', 0],
    ['dubstepDrums · bd', '1', 1],
    ['dubstepDrums · sd', '1', 1],
    ['dubstepDrums · hh', '1/8', 1],
    ['dubstepDrums · oh', '1/2', 1],
    ['subBass', '4', 5],
    ['wobbleBass', '4', 5],
    ['breakdown · triangle', '1', 4],
  ]);
  const renamed = {
    ...f,
    now: 1,
    notes: f.notes
      .map((n, i) => ({ ...n, value: { ...n.value, gain: i / 100, cutoff: i + 100 } }))
      .reverse(),
    instruments: f.instruments
      .map((i) => ({ ...i, name: 'renamed', muted: true, inSection: false }))
      .reverse(),
  };
  expect(indexOrrery(renamed)).toEqual(q);
  expect(q.common).toEqual({ n: 4, d: 1 });
  expect(alignment(q.common, 10.4)?.next).toBe(12);
  const shift = {
    ...f,
    from: 28,
    to: 56,
    now: 38.4,
    notes: f.notes.map((n) => ({ ...n, start: n.start + 28, end: n.end + 28 })),
  };
  expect(indexOrrery(shift)).toEqual(q);
});
it('rejects varying note patterns even if onset rhythm repeats; does not let section gaps erase orbits', () => {
  const f = scoreFrame();
  f.to = 8;
  f.sections = [
    { name: 'a', from: 0, to: 2 },
    { name: 'rest', from: 2, to: 6 },
    { name: 'b', from: 6, to: 8 },
  ];
  f.notes = [note(0, 1), note(1, 2), note(6, 7), note(7, 8)];
  expect(indexOrrery(f).orbits[0].period).toEqual({ n: 1, d: 1 });
  f.notes[3] = note(7, 8, { note: 'd3' });
  expect(indexOrrery(f).orbits[0].period).toBeNull();
});
it('counts dense motif marks, retains twenty orbits, and reserves separate text space at Stage B', () => {
  const f = scoreFrame(20);
  f.to = 2;
  f.notes = Array.from({ length: 1000 }, (_, i) => note(i / 500, (i + 1) / 500, { note: i % 500 }));
  const q = indexOrrery(f);
  expect(q.orbits).toHaveLength(20);
  expect(q.orbits[0].period).toEqual({ n: 1, d: 1 });
  expect(orbitMarks(q.orbits[0], 50).reduce((sum, m) => sum + m.count, 0)).toBe(500);
  expect(orbitMarks(q.orbits[0], 50).length).toBeLessThan(30);
  for (const [w, h] of [
    [1300, 760],
    [1131, 469],
    [559, 675],
    [559, 469],
  ]) {
    const b = orreryLayout(w, h, 20);
    expect(b.shown + b.hidden).toBe(20);
    expect(b.radius).toBeGreaterThan(50);
    const worldWidth = b.narrow ? w : b.ledger.x - 12;
    expect(b.rx * 2).toBeGreaterThan(worldWidth * 0.85);
    expect(b.cx - b.rx).toBeGreaterThanOrEqual(24);
    expect(b.cy - b.radius).toBeGreaterThan(90);
    expect(b.ledger.y + 23 + b.shown * 26).toBeLessThan(h - 83);
  }
  const techno = indexOrrery(corpus.get('real-techno')!);
  expect(techno.orbits.filter((o) => o.period).length).toBeGreaterThan(0);
});

it('accounts for control fragments through a matching whole-note onset, never adding attacks', () => {
  const f = scoreFrame();
  f.to = 4;
  f.notes = [note(0, 1), note(1, 2), note(2, 3), note(3, 4)];
  const expected = indexOrrery(f);
  const fragments: ViewNote[] = f.notes.map((n) => ({
    ...n,
    hasOnset: false,
    value: { ...n.value, cutoff: 800 },
  }));
  expect(indexOrrery({ ...f, notes: [...f.notes, ...fragments] })).toEqual(expected);
  fragments[0] = { ...fragments[0], value: { note: 'd3', cutoff: 800 } };
  expect(indexOrrery({ ...f, notes: [...f.notes, ...fragments] }).orbits[0].period).toBeNull();
});

it('never ignores notes outside section coverage or double-counts overlapping observations as repeats', () => {
  const f = scoreFrame();
  f.to = 6;
  f.sections = [
    { name: 'a', from: 0, to: 2 },
    { name: 'b', from: 4, to: 6 },
  ];
  f.notes = [note(0, 1), note(1, 2), note(2, 3), note(4, 5), note(5, 6)];
  expect(indexOrrery(f).orbits[0].period).toBeNull();
  f.sections = [
    { name: 'a', from: 0, to: 1 },
    { name: 'b', from: 0, to: 1 },
  ];
  f.notes = [note(0, 1)];
  expect(indexOrrery(f).orbits[0].period).toBeNull();
});

it('finds the smallest grid period when section gates hide intervening repeats', () => {
  for (const count of [2, 4]) {
    const f = scoreFrame();
    f.to = count * 8 - 4;
    f.sections = Array.from({ length: count * 2 - 1 }, (_, i) => ({
      name: String(i),
      from: i * 4,
      to: (i + 1) * 4,
    }));
    f.notes = Array.from({ length: count }, (_, i) => note(3 + i * 8, 3.5 + i * 8));
    const q = indexOrrery(f);
    expect(q.orbits[0].period).toEqual({ n: 4, d: 1 });
    expect(q.orbits[0].marks).toEqual([{ phase: 0.75, count: 1 }]);
    expect(q.common).toEqual({ n: 4, d: 1 });
    // The same coverage/gap relation holds below a bar, without integer rounding.
    const fraction = indexOrrery({
      ...f,
      to: f.to / 3,
      sections: f.sections.map((s) => ({ ...s, from: s.from / 3, to: s.to / 3 })),
      notes: f.notes.map((n) => ({ ...n, start: n.start / 3, end: n.end / 3 })),
    });
    expect(fraction.orbits[0].period).toEqual({ n: 4, d: 3 });
    expect(fraction.common).toEqual({ n: 4, d: 3 });
  }
});
