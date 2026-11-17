import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, viewNotes } from '../../src/studio/frame';
import { themes } from '../../src/studio/themes';
import { queryEventsNode } from '../node-query';
import {
  featured,
  figures,
  outfit,
  runway,
  valueText,
  scoredNotes,
} from '../../src/views/catwalk/model';
import type { ViewFrame, ViewNote } from '../../src/views/types';
import { scoreFrame } from './score-fixture';

let real: ViewFrame;
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  const events = Object.fromEntries(
    await Promise.all(
      state.rows.map(async (row) => {
        const result = await queryEventsNode(generate(state.doc!, { only: row.id }), 8, 16);
        expect(result.error).toBeNull();
        return [row.id, result];
      }),
    ),
  );
  const score = { from: 8, to: 16, events };
  real = buildFrame({
    state,
    score,
    notes: viewNotes(score),
    now: 10.4,
    playing: false,
    cps: 140 / 240,
    theme: themes.arcade,
    lookAhead: 1,
    trails: 1,
    width: 1300,
    height: 760,
    dpr: 1,
  });
});
const note = (
  start: number,
  end: number,
  value: ViewNote['value'] = {},
  instrument = '0',
  hasOnset = true,
): ViewNote => ({ start, end, value, instrument, hasOnset });
const frame = (notes: ViewNote[], now = 1): ViewFrame => ({
  ...scoreFrame(),
  notes,
  now,
  lookAhead: 1,
});

it('lands exactly on onset, poses for the scored hold, then leaves; arbitrary seeks reproduce the pose', () => {
  const notes = [note(1, 2, { gain: 0.75, lpf: 1370 })];
  const f = frame(notes);
  const before = figures({ ...f, now: 0.5 })[0];
  const start = figures(f)[0];
  const held = figures({ ...f, now: 1.7 })[0];
  expect(before.y).toBeLessThan(runway(f).front);
  expect(before.posing).toBe(false);
  expect(start.y).toBe(runway(f).front);
  expect(start.posing).toBe(true);
  expect(held.y).toBe(start.y);
  expect(held.stride).toBe(0);
  expect(held.outfit).toEqual(start.outfit);
  expect(figures({ ...f, now: 2 })).toEqual([]);
  expect(figures(f)[0]).toEqual(start);
});
it('each sampled key gets one garment, including a badge for unfamiliar settings, independent of bag order', () => {
  const bag = {
    lpf: 940,
    room: 0.25,
    shape: 0.65,
    resonance: 11,
    hpf: 110,
    gain: 0.75,
    pan: 0.2,
    custom: ['a', 2],
  };
  const dressed = outfit(note(0, 1, bag));
  expect(dressed.map((i) => [i.name, i.garment])).toEqual([
    ['custom', 'badge'],
    ['gain', 'size'],
    ['hpf', 'boots'],
    ['lpf', 'hat'],
    ['pan', 'side'],
    ['resonance', 'antenna'],
    ['room', 'cape'],
    ['shape', 'spikes'],
  ]);
  expect(outfit(note(0, 1, Object.fromEntries(Object.entries(bag).reverse())))).toEqual(dressed);
  expect(valueText(bag.custom)).toBe('["a",2]');
  for (const [name, value] of Object.entries(bag))
    expect(dressed.find((i) => i.name === name)?.value).toEqual(value);
});
it('values size garments between notes; gain sizes figures and pan places them on opposite sides', () => {
  for (const name of ['lpf', 'room', 'shape', 'resonance', 'hpf'])
    expect(outfit(note(0, 1, { [name]: 0 }))[0].size).toBeLessThan(
      outfit(note(0, 1, { [name]: name === 'lpf' ? 12000 : 1 }))[0].size,
    );
  const left = figures(frame([note(1, 2, { pan: 0, gain: 0.2 })]))[0];
  const right = figures(frame([note(1, 2, { pan: 1, gain: 2 })]))[0];
  expect(left.x).toBeLessThan(650);
  expect(right.x).toBeGreaterThan(650);
  expect(left.scale).toBeLessThan(right.scale);
});
it('does not turn future fragments into arrivals, but preserves currently held fragments and zero gain', () => {
  const notes = [note(0, 2, { gain: 0 }, '0', false), note(1.5, 2, {}, '0', false)];
  const cast = figures(frame(notes));
  expect(cast).toHaveLength(1);
  expect(cast[0].note).toBe(notes[0]);
  expect(cast[0].posing).toBe(true);
  expect(cast[0].outfit[0].value).toBe(0);
});
it('one and twenty instruments and 500 notes per cycle retain all visible notes in explicit crowds', () => {
  for (const count of [1, 20]) {
    const f = {
      ...scoreFrame(count),
      now: 0.4,
      lookAhead: 1,
      notes: Array.from({ length: 500 }, (_, i) =>
        note(i / 500, i / 500 + 0.5, { gain: 1 }, String(i % count)),
      ),
    };
    const cast = figures(f);
    expect(cast.reduce((sum, c) => sum + c.members.length, 0)).toBe(500);
    expect(cast.length).toBeLessThan(64);
    expect(cast.some((c) => c.members.length > 1)).toBe(true);
    expect(cast.every((c) => c.x > 0 && c.x < f.width && c.scale > 0)).toBe(true);
  }
});
it('real bar 11 bags use sampled values, including keys beyond the mockup; host refresh and names cannot change the outfit', () => {
  const cast = figures(real);
  const featuredNotes = featured(cast, real.width);
  expect(featuredNotes.length).toBeGreaterThan(0);
  for (const f of cast) {
    expect(f.outfit.map((i) => i.name)).toEqual(Object.keys(f.note.value).sort());
    expect(f.outfit).toEqual(outfit(f.note));
  }
  const bass = cast.find(
    (c) => typeof c.note.value.cutoff === 'number' || typeof c.note.value.lpf === 'number',
  )!;
  expect(bass).toBeDefined();
  expect(bass.members.filter((n) => n.instrument === bass.instrument.id)).toHaveLength(1);
  const earlier = figures({ ...real, now: 10.2 }).find((c) => c.note === bass.note);
  const later = figures({ ...real, now: 10.7 }).find((c) => c.note === bass.note);
  expect(earlier?.outfit).toEqual(bass.outfit);
  expect(later?.outfit).toEqual(bass.outfit);
  const renamed = figures({
    ...real,
    instruments: real.instruments.map((i) => ({ ...i, name: 'renamed' })),
  });
  expect(renamed.map((c) => [c.x, c.y, c.outfit])).toEqual(cast.map((c) => [c.x, c.y, c.outfit]));
  const refreshed = figures({
    ...real,
    notes: real.notes.filter((n) => n.end > 10 && n.start < 12),
  });
  expect(refreshed.find((c) => c.note === bass.note)?.outfit).toEqual(bass.outfit);
  console.log(
    'Catwalk bar 11 posing bags:',
    JSON.stringify(featuredNotes.map((f) => ({ name: f.instrument.name, value: f.note.value }))),
  );
});

it('collapses identical query continuations without dropping coincident note onsets', () => {
  const onset = note(0, 2, { gain: 1, note: 48 });
  const fragment = { ...onset, hasOnset: false };
  expect(scoredNotes([fragment, onset, fragment])).toEqual([onset]);
  expect(scoredNotes([onset, onset, fragment])).toEqual([onset, onset]);
  expect(scoredNotes([fragment, fragment])).toEqual([fragment, fragment]);
  expect(scoredNotes([fragment, { ...fragment, value: { gain: 0.5, note: 48 } }])).toHaveLength(2);
});

it('moderate pan values keep their side even at the extremes of the instrument fan', () => {
  const f = {
    ...scoreFrame(2),
    now: 1,
    lookAhead: 1,
    notes: [note(1, 2, { pan: 0.75 }, '0'), note(1, 2, { pan: 0.25 }, '1')],
  };
  const cast = figures(f);
  expect(cast.find((c) => c.instrument.id === '0')!.x).toBeGreaterThan(f.width / 2);
  expect(cast.find((c) => c.instrument.id === '1')!.x).toBeLessThan(f.width / 2);
});

it('held positions and crowd membership survive other instruments and dense notes entering the Window (R1)', () => {
  const held = note(1, 3, { gain: 0.8, lpf: 900 }, '1');
  const f = {
    ...scoreFrame(3),
    lookAhead: 1,
    notes: [note(1, 3), held, ...Array.from({ length: 80 }, () => note(2.5, 3, {}, '2'))],
  };
  for (const width of [1300, 560]) {
    const poseAt = (now: number) =>
      figures({ ...f, now, width }).find((c) => c.members.includes(held))!;
    const before = poseAt(1.4);
    const after = poseAt(1.6);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.scale).toBe(before.scale);
    expect(after.members).toEqual(before.members);
    expect(poseAt(1.4)).toEqual(before);
  }
});

it('a walking crowd is anchored by its earliest onset rather than a richer later outfit (R2)', () => {
  const earlier = note(1.55, 2, { gain: 1 });
  const later = note(1.6, 2, { lpf: 900, shape: 0.6 });
  for (const notes of [
    [later, earlier],
    [earlier, later],
  ]) {
    const cast = figures(frame(notes));
    expect(cast).toHaveLength(1);
    expect(cast[0].note).toBe(earlier);
    expect(cast[0].members).toHaveLength(2);
    expect(cast[0].y).toBe(figures(frame([earlier]))[0].y);
  }
});
