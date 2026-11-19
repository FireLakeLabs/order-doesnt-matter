import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { instruments } from '../../src/document';
import { createStructureCache } from '../../src/studio/program-structure';
import { createDriverOrbits, driverPhase, driverTicks } from '../../src/views/orrery/drivers';
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

it('establishes long sixteenth/triplet-grid parts without spending a song-wide factoring budget', () => {
  for (const [bars, triplet] of [
    [64, true],
    [128, true],
    [128, false],
  ] as const) {
    const f = scoreFrame();
    f.to = bars;
    f.sections = [{ name: 'Whole song', from: 0, to: bars }];
    f.notes = Array.from({ length: bars }, (_, bar) => [
      ...Array.from({ length: 16 }, (_, step) =>
        note(bar + step / 16, bar + (step + 1) / 16, { s: 'hh' }),
      ),
      ...(triplet ? [note(bar + 1 / 3, bar + 2 / 3, { s: 'oh' })] : []),
    ]).flat();
    const q = indexOrrery(f);
    expect(q.orbits[0].period).toEqual(triplet ? { n: 1, d: 1 } : { n: 1, d: 16 });
    expect(q.orbits[0].observed).toBe(bars * (triplet ? 17 : 16));
    expect(q.orbits[0].marks.reduce((sum, mark) => sum + mark.count, 0)).toBe(triplet ? 17 : 1);
    expect(q.complete).toBe(true);
  }
});

it('keeps extreme unresolved grids bounded without claiming a period', () => {
  const f = scoreFrame();
  const gap = 1_000_003 ** 2;
  f.to = gap * 2;
  f.notes = [note(0, 1), note(gap, gap + 1)];
  expect(indexOrrery(f).orbits[0]).toMatchObject({
    period: null,
    reason: 'inference grid too large',
    observed: 2,
  });
});

it('retains exact recovered tick coordinates on fine coprime grids at later song offsets', () => {
  for (const from of [0, 8, 14, 16, 24, 30]) {
    const f = scoreFrame();
    f.from = from;
    f.to = from + 2;
    f.now = from + 0.4;
    f.sections = [{ name: 'Tiny subdivisions', from: 0, to: 2 }];
    f.notes = [from, from + 1].flatMap((bar) =>
      [4093, 4091, 4079, 4073].map((d) => note(bar + 1 / d, bar + 2 / d)),
    );
    expect(indexOrrery(f).orbits[0].period).toEqual({ n: 1, d: 1 });
  }
});

// Driver snapshots use definition time, independently of the arranged note score.

it('maps the real Dubstep driver loop and four speed segments without integrating frame history', async () => {
  const doc = importStrudel(
    readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
  ).doc;
  const f = corpus.get('real-dubstep-arranged')!;
  const cache = createStructureCache({ query: queryEventsNode, cancel() {} });
  const drivers = createDriverOrbits();
  const frame = { ...f, structure: cache.forFrame(doc, f) };
  const bass = instruments(doc).find((row) => row.name === 'wobbleBass')!;
  expect(drivers.get(frame).find((moon) => moon.instrument === bass.id)?.status).toBe('pending');
  const structure = frame.structure.get(bass.id)!;
  const filter = structure.steps.find((step) => step.kind === 'setting' && step.name === 'cutoff')!;
  if (filter.kind !== 'setting') throw Error('Missing filter');
  await filter.driver.rates[0].events();
  const moon = drivers.get(frame).find((moon) => moon.instrument === bass.id)!;
  expect(moon.status).toBe('known');
  expect(moon.period).toEqual({ n: 4, d: 1 });
  expect(moon.segments.map((segment) => segment.rate)).toEqual([2, 4, 3, 8]);
  expect(driverTicks(moon)).toEqual([0, 2 / 17, 6 / 17, 9 / 17]);
  for (const [now, rate, phase] of [
    [8.4, 2, 0.8 / 17],
    [9.4, 4, 3.6 / 17],
    [10.4, 3, 7.2 / 17],
    [11.4, 8, 12.2 / 17],
  ]) {
    expect(driverPhase(moon, now)?.rate).toBe(rate);
    expect(driverPhase(moon, now)?.phase).toBeCloseTo(phase);
  }
  expect(driverPhase(moon, 10.4)?.phase).toBeCloseTo(driverPhase(moon, 22.4)!.phase);
  expect(driverPhase(moon, 18.4)).toBeNull();
  expect(driverPhase(moon, 11)?.rate).toBe(8);
  drivers.dispose();
  cache.dispose();
});

it('maps a 3-cycle arrangement offset and an affine use-site scale; does not guess opaque rates or rewrites', async () => {
  for (const [expression, known] of [
    ['sine.fast("<2 4 3 8>")', true],
    ['sine.fast("<2 4 3 8>").slow(2)', false],
    ['sine.fast("<2 4 3 8>").rev()', false],
    ['sine.fast("<2 4 3 8>").range(200,900)', true],
  ] as const) {
    const doc = importStrudel(
      `const pad = note("c e").lpf(${expression}); arrange([3, s("bd")], [16, pad.fast(2)]);`,
    ).doc;
    const rows = instruments(doc);
    const row = rows.find((row) => row.name === 'pad')!;
    const cache = createStructureCache({ query: queryEventsNode, cancel() {} });
    const f = {
      ...scoreFrame(rows.length),
      from: 0,
      to: 19,
      structure: cache.forFrame(doc, { from: 0, to: 19 }),
    };
    f.instruments.forEach((instrument, index) => {
      instrument.id = rows[index].id;
    });
    const drivers = createDriverOrbits();
    drivers.get(f);
    const filter = f.structure.get(row.id)!.steps.find((step) => step.kind === 'setting')!;
    if (filter.kind !== 'setting') throw Error('Missing filter');
    await Promise.all(filter.driver.rates.map((rate) => rate.events()));
    const moons = drivers.get(f).filter((moon) => moon.instrument === row.id);
    expect(moons.length).toBeGreaterThan(0);
    expect(moons[0].status).toBe(known ? 'known' : 'unknown');
    if (known) {
      expect(driverPhase(moons[0], 4.2)?.local).toBeCloseTo(2.4);
      expect(driverPhase(moons[0], 4.2)?.phase).toBeCloseTo(7.2 / 17);
      expect(driverPhase(moons[0], 4.2)?.period).toEqual({ n: 2, d: 1 });
    }
    drivers.dispose();
    cache.dispose();
  }
});

it('keeps unavailable, broken, random, nonrational and incomplete driver answers explicitly unknown', async () => {
  const doc = importStrudel('note("c").lpf(sine.fast("<2 4 3 8>"))').doc;
  for (const query of [
    async () => ({ events: [], cps: 1, error: null, opaqueValues: false }),
    async () => ({
      events: [],
      cps: 1,
      error: { phase: 'query' as const, message: 'broken' },
      opaqueValues: false,
    }),
    async () => {
      throw Error('unavailable');
    },
    async () => queryEventsNode('"<2 4 3 8>".degradeBy(.3)', 0, 16),
    async () => queryEventsNode('"<2 4 3 8>".mul(Math.sqrt(2))', 0, 16),
    async () => queryEventsNode('"<2 4 3 8>"', 0, 2),
  ]) {
    const cache = createStructureCache({ query, cancel() {} });
    const f = scoreFrame();
    f.to = 16;
    f.instruments[0].id = instruments(doc)[0].id;
    f.structure = cache.forFrame(doc, f);
    const drivers = createDriverOrbits();
    expect(drivers.get(f)[0].status).toBe('pending');
    const step = f.structure
      .get(f.instruments[0].id)!
      .steps.find((step) => step.kind === 'setting')!;
    if (step.kind !== 'setting') throw Error('Missing filter');
    await step.driver.rates[0].events();
    expect(drivers.get(f)[0].status).toBe('unknown');
    drivers.dispose();
    cache.dispose();
  }
});

it('refuses a scaled rate loop outside the recoverable rational grid', async () => {
  const doc = importStrudel(
    'const pad = note("c").lpf(sine.fast("<2 4 3 8>".fast(4091))); pad.fast(4093)',
  ).doc;
  const row = instruments(doc)[0];
  const cache = createStructureCache({ query: queryEventsNode, cancel() {} });
  const f = scoreFrame();
  f.to = 0.002;
  f.instruments[0].id = row.id;
  f.structure = cache.forFrame(doc, f);
  const drivers = createDriverOrbits();
  drivers.get(f);
  const filter = f.structure.get(row.id)!.steps.find((step) => step.kind === 'setting')!;
  if (filter.kind !== 'setting') throw Error('Missing filter');
  await filter.driver.rates[0].events();
  expect(drivers.get(f)[0]).toMatchObject({
    status: 'unknown',
    reason: 'Song-time rate period is not a recoverable rational',
  });
  drivers.dispose();
  cache.dispose();
});

it('uses reciprocal speed for slow rate patterns and marks changes rather than repeated equal values', async () => {
  const doc = importStrudel('note("c").lpf(sine.slow("<2 2 4>"))').doc;
  const row = instruments(doc)[0];
  const cache = createStructureCache({ query: queryEventsNode, cancel() {} });
  const f = scoreFrame();
  f.to = 12;
  f.instruments[0].id = row.id;
  f.structure = cache.forFrame(doc, f);
  const drivers = createDriverOrbits();
  drivers.get(f);
  const filter = f.structure.get(row.id)!.steps.find((step) => step.kind === 'setting')!;
  if (filter.kind !== 'setting') throw Error('Missing filter');
  await filter.driver.rates[0].events();
  const moon = drivers.get(f)[0];
  expect(moon.status).toBe('known');
  expect(moon.period).toEqual({ n: 3, d: 1 });
  expect(driverTicks(moon)).toEqual([0, 0.8]);
  expect(driverPhase(moon, 0.5)?.phase).toBeCloseTo(0.2);
  expect(driverPhase(moon, 2.5)?.phase).toBeCloseTo(0.9);
  drivers.dispose();
  cache.dispose();
});

it('includes literal arrays that Strudel reifies as patterned signal rates', async () => {
  const doc = importStrudel('note("c").lpf(sine.fast([2,4]))').doc;
  const row = instruments(doc)[0];
  const cache = createStructureCache({ query: queryEventsNode, cancel() {} });
  const f = scoreFrame();
  f.to = 4;
  f.instruments[0].id = row.id;
  f.structure = cache.forFrame(doc, f);
  const drivers = createDriverOrbits();
  expect(drivers.get(f)).toHaveLength(1);
  const filter = f.structure.get(row.id)!.steps.find((step) => step.kind === 'setting')!;
  if (filter.kind !== 'setting') throw Error('Missing filter');
  await filter.driver.rates[0].events();
  const moon = drivers.get(f)[0];
  expect(moon.status).toBe('known');
  expect(moon.period).toEqual({ n: 1, d: 1 });
  expect(driverTicks(moon)).toEqual([0, 1 / 3]);
  expect(driverPhase(moon, 0.75)?.phase).toBeCloseTo(2 / 3);
  drivers.dispose();
  cache.dispose();
});
