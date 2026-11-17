import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { type AppState, initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, neededRange, viewNotes } from '../../src/studio/frame';
import {
  analyse,
  roles,
  scene,
  roofY,
  roofAt,
  kind,
  searchlight,
  parallaxRates,
} from '../../src/views/ash-run/model';
import type { ViewFrame } from '../../src/views/types';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
let state: AppState;
let frame: ViewFrame;
async function queried(now: number, range?: { from: number; to: number }, piece = state) {
  const span = range ?? neededRange(undefined, now, 1, piece.sections);
  const entries = await Promise.all(
    piece.rows.map(
      async (row) =>
        [
          row.id,
          await queryEventsNode(generate(piece.doc!, { only: row.id }), span.from, span.to),
        ] as const,
    ),
  );
  for (const [, r] of entries) expect(r.error).toBeNull();
  const score = { ...span, events: Object.fromEntries(entries) };
  return buildFrame({
    state: piece,
    score,
    notes: viewNotes(score),
    now,
    cps: 140 / 240,
    playing: false,
    theme: scoreFrame().theme,
    lookAhead: 1,
    trails: 1,
    width: 1300,
    height: 760,
    dpr: 1,
  });
}
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  state = loadPiece(initialState(), source, importStrudel(source));
  frame = await queried(10.4);
});

it('recognises four-beat backbeats and strong-beat kicks in the other real drum grooves', async () => {
  for (const program of ['real-synthwave', 'real-dnb', 'real-future-bass', 'real-dnb-arranged']) {
    const source = readFileSync(`corpus/programs/${program}.strudel`, 'utf8');
    const piece = loadPiece(initialState(), source, importStrudel(source));
    const f = await queried(2.4, undefined, piece),
      chosen = roles(f, analyse(f.notes));
    expect(f.instruments.find((i) => i.id === chosen.snare)?.name, program).toBe('sd');
    expect(chosen.openHat, program).not.toBe(chosen.snare);
    if (program === 'real-synthwave') {
      expect(f.instruments.find((i) => i.id === chosen.kick)?.name).toBe('bd');
      expect(chosen.openHat).toBeUndefined();
    }
  }
  const bd = frame.instruments.find((i) => i.name === 'bd')!;
  const source = frame.notes.find((n) => n.instrument === bd.id && n.hasOnset)!;
  const notes = Array.from({ length: 16 }, (_, i) => ({
    ...source,
    start: i / 4,
    end: (i + 1) / 4,
  }));
  const f = { ...frame, notes, instruments: [bd] };
  expect(roles(f, analyse(notes)).kick).toBe(bd.id);
});

it('keeps a half-time snare out of the kick role when the kick is syncopated', () => {
  const bd = frame.instruments.find((i) => i.name === 'bd')!;
  const sd = frame.instruments.find((i) => i.name === 'sd · drop')!;
  const source = frame.notes.find((n) => n.instrument === bd.id && n.hasOnset)!;
  const snares = frame.notes.filter((n) => n.instrument === sd.id && n.start >= 8 && n.start < 16);
  for (const phases of [
    [0, 0.375],
    [0, 0.625],
    [0, 0.75, 0.875],
  ]) {
    const notes = [
      ...snares,
      ...Array.from({ length: 8 }, (_, i) =>
        phases.map((phase) => ({
          ...source,
          start: 8 + i + phase,
          end: 8 + i + phase + 0.125,
        })),
      ).flat(),
    ];
    const f = { ...frame, notes, instruments: [bd, sd] };
    const chosen = roles(f, analyse(notes));
    expect(chosen.snare, String(phases)).toBe(sd.id);
    expect(chosen.kick, String(phases)).toBeUndefined();
    expect(kind(bd.id, chosen)).toBe('generic');
  }
});

it('starts a touching-roof leap at the old height and lands on the new roof', () => {
  const data = analyse(frame.notes);
  const before = scene({ ...frame, now: 11 - 1e-8 }, data);
  const onset = scene({ ...frame, now: 11 }, data);
  expect(onset.current?.note.value.note).toBe('f1');
  expect(onset.feet).toBeCloseTo(before.feet, 5);
  expect(onset.feet).toBeCloseTo(roofY(27, frame.height));
  expect(scene({ ...frame, now: 11 + 1e-8 }, data).feet).toBeCloseTo(onset.feet, 4);
  const landing = scene({ ...frame, now: 11.25 }, data);
  expect(landing.feet).toBeCloseTo(roofY(29, frame.height));
});
it('chooses scored bass, downbeat footfalls, backbeat barriers, kick dust and offbeat cables without names', () => {
  const data = analyse(frame.notes),
    chosen = roles(frame, data);
  const name = (id: string | undefined) => frame.instruments.find((i) => i.id === id)?.name;
  expect(
    [chosen.rooftops, chosen.footfalls, chosen.snare, chosen.kick, chosen.openHat].map(name),
  ).toEqual(['subBass', 'bd', 'sd · drop', 'bd', 'oh']);
  const renamed = {
    ...frame,
    instruments: frame.instruments.map((i) => ({ ...i, name: 'renamed' })),
    notes: frame.notes.map((n) => ({ ...n, value: { ...n.value, s: 'renamed' } })),
  };
  expect(roles(renamed, analyse(renamed.notes))).toEqual(chosen);
  const light = searchlight(frame, data)!;
  expect(name(light.instrument)).toBe('hh · drop');
  expect(light.key).toBe('gain');
});

it('builds exact bass note spans with monotonic pitch height and leaps triggered on bass onsets', () => {
  const data = analyse(frame.notes),
    s = scene(frame, data);
  expect(s.roofs).toHaveLength(10);
  expect(s.current?.note).toMatchObject({ start: 10, end: 11, value: { note: 'eb1' } });
  expect(s.x(11) - s.x(10)).toBeCloseTo(s.scale);
  expect(s.x(11.5) - s.x(11)).toBeCloseTo(s.scale / 2);
  expect(roofY(24, 760)).toBeGreaterThan(roofY(27, 760));
  expect(roofY(27, 760)).toBeGreaterThan(roofY(31, 760));
  expect(s.feet).toBeCloseTo(roofY(27, 760));
  expect(s.stride).toBeCloseTo(0.4);
  expect(scene({ ...frame, now: 10 }, data).leap).toBe(0);
  expect(scene({ ...frame, now: 10.125 }, data).leap).toBeGreaterThan(30);
  expect(scene({ ...frame, now: 10.25 }, data).leap).toBeCloseTo(0);
  expect(roofAt(s.roofs, 11.5)?.note.value.note).toBe('g1');
});
it('keeps the bass role when it sits out the breakdown, exposing a real four-cycle chasm', async () => {
  const f = await queried(18.4),
    data = analyse(f.notes),
    s = scene(f, data);
  expect(f.instruments.find((i) => i.id === s.roles.rooftops)?.name).toBe('subBass');
  expect(f.instruments.find((i) => i.id === s.roles.rooftops)?.inSection).toBe(false);
  expect(s.chasm).toBe(true);
  expect(s.current).toBeUndefined();
  expect(s.roofs.every((e) => e.note.end <= 16 || e.note.start >= 20)).toBe(true);
  expect(s.feet).toBeGreaterThan(80);
  expect(s.feet).toBeLessThan(f.height * 0.76);
});
it('uses generic debris when unpitched onset phases do not establish drum roles', () => {
  const notes = frame.notes
    .filter((n) => n.hasOnset && n.value.s === 'oh')
    .map((n) => ({ ...n, start: n.start + 0.123, end: n.end + 0.123 }));
  const id = notes[0].instrument;
  const f = { ...frame, notes, instruments: frame.instruments.filter((i) => i.id === id) };
  const chosen = roles(f, analyse(notes));
  expect(chosen).toMatchObject({
    rooftops: undefined,
    kick: undefined,
    snare: undefined,
    openHat: undefined,
  });
  expect(kind(id, chosen)).toBe('generic');
  expect(chosen.footfalls).toBe(id);
});
it('samples the searchlight once per actual note and ignores float noise in constant cutoff samples', () => {
  const data = analyse(frame.notes);
  const a = searchlight({ ...frame, now: 10.38 }, data)!,
    b = searchlight({ ...frame, now: 10.47 }, data)!;
  expect(a.note?.start).toBe(10.375);
  expect(a.angle).toBe(b.angle);
  expect(searchlight({ ...frame, now: 10.51 }, data)!.angle).not.toBe(a.angle);
  expect(a.key).toBe('gain');
  expect(searchlight({ ...frame, notes: [], instruments: [] }, analyse([]))).toBeUndefined();
});
it('folds setting continuations, preserves unison onsets and uses the upper surface of simultaneous roofs', () => {
  const source = frame.notes.find(
    (n) => n.hasOnset && n.start === 10 && n.end === 11 && n.value.note === 'eb1',
  )!;
  const full = analyse(frame.notes).parts.get(source.instrument)!;
  expect(full.filter((e) => e.note.start === 10 && e.note.end === 11)).toHaveLength(1);
  expect(analyse([source, { ...source }]).parts.get(source.instrument)).toHaveLength(2);
  const fragment = { ...source, hasOnset: false };
  expect(analyse([fragment, { ...fragment }]).parts.get(source.instrument)).toHaveLength(1);
  const chord = analyse([fragment, { ...fragment, value: { note: 'g1' } }]).parts.get(
    source.instrument,
  )!;
  expect(chord).toHaveLength(2);
  expect(roofAt(chord, 10.4)?.note.value.note).toBe('g1');
  const f = { ...frame, notes: [fragment] };
  expect(scene(f, analyse(f.notes)).current?.note.hasOnset).toBe(false);
});
it('keeps real note geometry and role choices when the host cache window changes', async () => {
  for (const now of [8, 12, 20]) {
    const old = neededRange(undefined, now - 0.05, 1, state.sections),
      next = neededRange(undefined, now, 1, state.sections);
    expect(next.from).toBe(old.from + 4);
    const a = await queried(now, old),
      b = await queried(now, next);
    const pose = (f: ViewFrame) => {
      const s = scene(f, analyse(f.notes));
      return {
        roles: s.roles,
        feet: s.feet,
        stride: s.stride,
        angle: s.light?.angle,
        roofs: s.roofs
          .filter((e) => s.x(e.note.end) > 0 && s.x(e.note.start) < f.width)
          .map((e) => [e.note.start, e.note.end, e.midi]),
      };
    };
    expect(pose(a)).toEqual(pose(b));
  }
});
it('uses four parallax rates and scales actual world speed with cps after Speed without moving a paused score', () => {
  const data = analyse(frame.notes),
    s = scene(frame, data),
    slow = scene({ ...frame, cps: frame.cps / 4 }, data);
  expect(parallaxRates).toHaveLength(4);
  expect(new Set(parallaxRates).size).toBe(4);
  expect(parallaxRates[3]).toBe(1);
  expect(slow.speed).toBeCloseTo(s.speed / 4);
  expect(slow.feet).toBe(s.feet);
  expect(slow.x(11)).toBe(s.x(11));
  expect(scene({ ...frame, now: 18.4 }, data).district.name).toBe('breakdown');
  expect(scene({ ...frame, now: 38.4 }, data).district.name).toBe('drop');
  expect(scene({ ...frame, sections: [] }, data).district.name).toBe('Uncharted');
  scene({ ...frame, now: 20 }, data);
  scene({ ...frame, now: 0 }, data);
  expect(scene(frame, data).feet).toBe(s.feet);
});
it('retains all five hundred corpus-derived spans at one and twenty instruments on both stages', () => {
  const source = frame.notes.find((n) => n.hasOnset && n.start === 10 && n.end === 11)!;
  for (const count of [1, 20])
    for (const width of [560, 1300]) {
      const f = { ...scoreFrame(count), now: 0.4, width, lookAhead: 1 };
      f.notes = Array.from({ length: 500 }, (_, i) => ({
        ...source,
        instrument: String(i % count),
        start: i / 500,
        end: (i + 1) / 500,
        value: { ...source.value, note: i % 80 },
      }));
      const data = analyse(f.notes),
        s = scene(f, data);
      expect([...data.parts.values()].reduce((sum, p) => sum + p.length, 0)).toBe(500);
      expect(s.roofs.length).toBe(count === 1 ? 500 : 25);
      expect(s.size).toBeGreaterThanOrEqual(58);
      expect(s.feet).toBeGreaterThan(80);
      expect(s.feet).toBeLessThan(f.height);
      expect(s.gate).toBeGreaterThan(s.size / 2);
    }
  const empty = { ...frame, notes: [], instruments: [] };
  expect(scene(empty, analyse([])).chasm).toBe(true);
});
