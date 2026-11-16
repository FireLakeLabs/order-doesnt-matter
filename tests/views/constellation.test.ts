import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { instrumentFacts } from '../../src/studio/view-instruments';
import { resolveTheme } from '../../src/studio/themes';
import { buildFrame, viewNotes } from '../../src/studio/frame';
import { generate } from '../../src/generate';
import { brightness, layout, overlap, pulse, rhythm } from '../../src/views/constellation/geometry';
import type { ViewFrame, ViewInstrument, ViewNote } from '../../src/views/types';
import { queryEventsNode } from '../node-query';

const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
const state = loadPiece(initialState(), source, importStrudel(source));
const measure = (s: string) => s.length * 6.7;
function frame(count = 1, width = 560): ViewFrame {
  return {
    now: 0.4,
    playing: true,
    cps: 0.5,
    notes: [],
    from: 0,
    to: 4,
    instruments: Array.from(
      { length: count },
      (_, index): ViewInstrument => ({
        id: String(index),
        name: `Voice ${index + 1}`,
        index,
        colour: '#ff4d8d',
        sounding: false,
        inSection: true,
        muted: false,
        settings: [],
        rewrites: [],
        room: 1,
      }),
    ),
    sections: [],
    rooms: [],
    lookAhead: 4,
    trails: 1,
    theme: resolveTheme('arcade'),
    width,
    height: 760,
    dpr: 1,
  };
}
const note = (start: number, end: number, cutoff = 500): ViewNote => ({
  instrument: '0',
  start,
  end,
  hasOnset: true,
  value: { cutoff },
});

test('sheet inventory is cached per document, retains order, classifications, constants and rewrites', () => {
  const doc = importStrudel(
    's("bd").lpf(sine.range(100, 2000)).gain("<0.2 1>").pan(0.4).fast(2).every(4, x => x.rev()).orbit(3)',
  ).doc;
  const facts = instrumentFacts(doc);
  expect(instrumentFacts(doc)).toBe(facts);
  expect([...facts.values()][0]).toMatchObject({
    settings: [
      { name: 's' },
      { name: 'lpf', label: 'cutoff', kind: 'signal' },
      { name: 'gain', kind: 'values' },
      { name: 'pan', kind: 'constant', value: 0.4 },
      { name: 'orbit', kind: 'constant', value: 3 },
    ],
    rewrites: ['fast 2', 'every 4, x ⇒ …'],
    room: 3,
  });
  expect(instrumentFacts(importStrudel('s("bd").pan(0.7)').doc)).not.toBe(facts);
});

test('real wobble signal is one cutoff per whole note, also when queried inside it', async () => {
  const bass = state.rows.find((row) => row.name === 'wobbleBass')!;
  const code = generate(state.doc!, { only: bass.id });
  const all = await queryEventsNode(code, 10, 12);
  expect(all.error).toBeNull();
  const bassEvents = all.events.filter(
    (e) => (e.value as Record<string, unknown>).s === 'sawtooth',
  );
  expect(bassEvents.length).toBeGreaterThan(3);
  for (const event of bassEvents)
    expect((event.value as Record<string, unknown>).cutoff).toBeCloseTo(1370, 8);
  for (const from of [10.2, 10.7]) {
    const result = await queryEventsNode(code, from, from + 0.1);
    expect(result.error).toBeNull();
    expect(result.events[0].whole).toEqual([10, 11]);
    expect((result.events[0].value as Record<string, unknown>).cutoff).toBeCloseTo(1370, 8);
  }
  const score = { from: 10, to: 12, events: { [bass.id]: all } };
  const built = buildFrame({
    state,
    score,
    notes: viewNotes(score),
    now: 10.4,
    cps: 140 / 240,
    playing: true,
    theme: resolveTheme('arcade'),
    width: 1300,
    height: 760,
    dpr: 1,
    lookAhead: 4,
    trails: 1,
  });
  expect(built.instruments.find((i) => i.id === bass.id)?.settings).toContainEqual({
    name: 'lpf',
    label: 'cutoff',
    kind: 'signal',
  });
  expect(built.instruments.filter((i) => i.inSection)).toHaveLength(6);
  expect(built.instruments.filter((i) => !i.inSection)).toHaveLength(7);
});

test('one, twenty and empty scores fit deterministic cells with non-overlapping discs', () => {
  for (const width of [560, 1300, 1920])
    for (const count of [0, 1, 20]) {
      const f = frame(count, width);
      const a = layout(f, measure);
      expect(a).toEqual(layout({ ...f, now: 3.2 }, measure));
      expect(a.discs).toHaveLength(count);
      for (const [i, d] of a.discs.entries()) {
        expect(d.x - d.radius).toBeGreaterThan(0);
        expect(d.x + d.radius).toBeLessThan(width);
        expect(d.y + d.radius).toBeLessThan(760);
        expect(d.radius).toBeGreaterThanOrEqual(Math.min(width, 760) * 0.04);
        for (const other of a.discs.slice(i + 1))
          expect(Math.hypot(d.x - other.x, d.y - other.y)).toBeGreaterThan(d.radius + other.radius);
      }
      expect(a.dense).toBe(count === 20);
    }
});

test('nine settings plus rewrites have legible labels at Stage B, without label or disc collisions', () => {
  const f = frame();
  f.instruments[0].settings = [
    'cutoff',
    'gain',
    'pan',
    'room',
    'attack',
    'release',
    'shape',
    'delay',
    'speed',
  ].map((name) => ({ name, label: name, kind: 'constant', value: 1 }));
  f.instruments[0].rewrites = ['fast 2', 'every 4'];
  const disc = layout(f, measure).discs[0];
  expect(disc.moons).toHaveLength(9);
  expect(disc.moons.every((moon) => moon.label.length > 0)).toBe(true);
  for (const [i, moon] of disc.moons.entries()) {
    expect(moon.radius).toBeGreaterThanOrEqual(9);
    for (const other of disc.moons.slice(i + 1)) expect(overlap(moon.box, other.box)).toBe(false);
  }
});

test('500 spans per cycle contribute occupancy, fragments never flash, and scrubbing is reversible', () => {
  const notes = Array.from({ length: 500 }, (_, i) => note(i / 500, (i + 0.5) / 500));
  const bins = rhythm(notes, 0);
  expect([...bins].reduce((a, b) => a + b, 0)).toBeCloseTo(128, 4);
  expect(pulse([{ ...note(0, 1), hasOnset: false }], 0, 0.5)).toBe(0);
  expect(pulse(notes, -1, 0.5)).toBe(0);
  const light = pulse(notes, 0.4, 0.5);
  pulse(notes, 2, 0.5);
  expect(pulse(notes, 0.4, 0.5)).toBe(light);
  const setting = { name: 'lpf', label: 'cutoff', kind: 'signal' as const };
  const steps = [note(0, 1, 100), note(1, 2, 2000)];
  expect(brightness(steps, setting, 0.2)).toBe(brightness(steps, setting, 0.8));
  expect(brightness(steps, setting, 1.2)).toBeGreaterThan(brightness(steps, setting, 0.8));
});

test('later score fragments cannot replace the setting value that started the voice', () => {
  const setting = { name: 'lpf', label: 'cutoff', kind: 'signal' as const };
  const notes = [note(0, 1, 100), { ...note(0, 1, 8000), hasOnset: false }, note(1, 2, 2000)];
  expect(brightness(notes, setting, 0.2)).toBe(0.25);
  expect(brightness(notes, setting, 0.8)).toBe(0.25);
  expect(brightness(notes, setting, 1.2)).toBe(1);
});

test('repeated ordered rewrites on a containing group remain distinct', () => {
  const doc = importStrudel('stack(s("bd"), s("hh")).fast(2).fast(2)').doc;
  for (const facts of instrumentFacts(doc).values())
    expect(facts.rewrites).toEqual(['fast 2', 'fast 2']);
});

test('moon labels clear the instrument name measured in its wider display font', () => {
  const input = frame();
  input.instruments[0].name = 'Wide title';
  input.instruments[0].settings = Array.from({ length: 9 }, (_, i) => ({
    name: `setting ${String(i)}`,
    label: `control ${String(i)}`,
    kind: 'constant',
    value: 1,
  }));
  const nameWidth = 300;
  const disc = layout(input, measure, () => nameWidth).discs[0];
  const nameBox = { x: disc.x - nameWidth / 2, y: disc.y + disc.radius + 10, w: nameWidth, h: 20 };
  expect(disc.moons).toHaveLength(9);
  expect(disc.moons.every((moon) => !overlap(moon.box, nameBox))).toBe(true);
});
