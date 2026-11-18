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
  analyse,
  cameraFlashes,
  gaitAt,
  stepAt,
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
        const result = await queryEventsNode(generate(state.doc!, { only: row.id }), 0, 28);
        expect(result.error).toBeNull();
        return [row.id, result];
      }),
    ),
  );
  const score = { from: 0, to: 28, events };
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

it('keeps one model per part through future entrances and rests, and rotates turns by bar', () => {
  const notes = [note(0, 4, {}, '0'), note(0, 4, {}, '1'), note(3, 4, {}, '2')];
  const f = { ...frame(notes, 0.1), instruments: scoreFrame(3).instruments };
  for (const [now, id] of [
    [0.1, '0'],
    [1.1, '1'],
    [2.1, '0'],
    [3.1, '0'],
  ] as const) {
    const cast = figures({ ...f, now });
    expect(cast).toHaveLength(3);
    expect(cast.filter((c) => c.walking).map((c) => c.instrument.id)).toEqual([id]);
    expect(cast.every((c) => c.scale > 0)).toBe(true);
  }
  const posed = figures({ ...f, now: 1.4 }).find((c) => c.walking)!;
  expect(posed.posing).toBe(true);
  expect(posed.y).toBe(runway(f).front);
  expect(figures({ ...f, now: 1.6 }).find((c) => c.walking)!.y).toBe(posed.y);
  const returned = figures({ ...f, now: 1.8 }).find((c) => c.walking)!;
  expect(returned.returning).toBe(true);
  expect(returned.facing).toBe(-1);
  expect(returned.y).toBeLessThan(posed.y);
  expect(figures({ ...f, now: 1.4 }).find((c) => c.walking)).toEqual(posed);
  expect(figures({ ...f, now: 1.99 }).some((c) => c.next && c.instrument.id === '0')).toBe(true);
});

it('keeps the document cast even when a part has no notes in the available score', () => {
  const f = { ...scoreFrame(2), now: 1.4, notes: [note(1, 2)] };
  const waiting = figures(f).find((c) => c.instrument.id === '1')!;
  expect(waiting.note).toBeUndefined();
  expect(waiting.walking).toBe(false);
  expect(waiting.outfit).toEqual([]);
  expect(waiting.scale).toBeGreaterThan(0);
});

it('hands the runway to the next model without teleporting either model at a bar boundary', () => {
  for (const count of [1, 3]) {
    const f = {
      ...scoreFrame(count),
      notes: Array.from({ length: count }, (_, id) => note(0, 4, {}, String(id))),
    };
    for (const bar of [1, 2, 3]) {
      const before = figures({ ...f, now: bar - 0.00001 });
      const after = figures({ ...f, now: bar + 0.00001 });
      for (const a of before) {
        const b = after.find((c) => c.instrument.id === a.instrument.id)!;
        expect(Math.abs(a.x - b.x)).toBeLessThan(0.1);
        expect(Math.abs(a.y - b.y)).toBeLessThan(0.1);
        expect(Math.abs(a.scale - b.scale)).toBeLessThan(0.001);
      }
    }
  }
});

it('changes the end pose on every walking-part onset and flourishes backstage', () => {
  const notes = [note(1, 1.1), note(1.4, 1.5), note(1.55, 1.6), note(1.4, 1.5, {}, '1')];
  const f = { ...frame(notes, 1.39), instruments: scoreFrame(2).instruments };
  // Bar 2 picks part 1; its note starts later, yet its model is already walking.
  const before = figures(f).find((c) => c.walking)!;
  const after = figures({ ...f, now: 1.4 }).find((c) => c.walking)!;
  expect(after.instrument.id).toBe('1');
  expect(after.pose).not.toBe(before.pose);
  expect(figures({ ...f, now: 1.4 }).find((c) => !c.walking)!.flourish).toBe(1);
  expect(figures({ ...f, now: 1.42 }).find((c) => !c.walking)!.flourish).toBeGreaterThan(0);
});

it('changes pose for successive triads while counting every note (R1)', () => {
  const notes = [0.4, 0.5, 0.6].flatMap((start) =>
    [48, 52, 55].map((pitch) => note(start, start + 0.05, { note: pitch })),
  );
  const f = frame(notes, 0.4);
  const cast = [0.4, 0.5, 0.6].map((now) => figures({ ...f, now })[0]);
  expect(cast.every((c) => c.posing)).toBe(true);
  expect(cast.map((c) => c.pose)).toEqual([1, 2, 0]);
  expect(cast.every((c) => c.members.length === 9)).toBe(true);
  expect(
    cameraFlashes({ ...f, now: 0.6 }, analyse(notes)).reduce((sum, flash) => sum + flash.count, 0),
  ).toBe(3);
});

it('keeps entrance and exit handoffs continuous when the song window advances (R2)', () => {
  for (const count of [2, 3]) {
    for (const from of [0, 4]) {
      const f = {
        ...scoreFrame(count),
        from,
        to: from + 4,
        sections: [{ name: 'show', from: 0, to: 4 }],
        notes: Array.from({ length: count }, (_, id) => note(from, from + 4, {}, String(id))),
      };
      const before = figures({ ...f, now: from + 3.99999 });
      const after = figures({
        ...f,
        from: from + 4,
        to: from + 8,
        now: from + 4.00001,
        notes: f.notes.map((n) => ({ ...n, start: n.start + 4, end: n.end + 4 })),
      });
      expect(before.find((c) => c.next)?.instrument.id).toBe(
        after.find((c) => c.walking)!.instrument.id,
      );
      expect(after.find((c) => c.walking)!.instrument.id).toBe(String((from + 4) % count));
      for (const a of before) {
        const b = after.find((c) => c.instrument.id === a.instrument.id)!;
        expect(Math.abs(a.x - b.x)).toBeLessThan(0.1);
        expect(Math.abs(a.y - b.y)).toBeLessThan(0.1);
        expect(Math.abs(a.scale - b.scale)).toBeLessThan(0.001);
      }
    }
  }
});

it('uses the latest sampled outfit, preserving zero gain and waiting through rests', () => {
  const first = note(0, 0.1, { gain: 0, lpf: 400 });
  const second = note(2, 2.1, { gain: 2, lpf: 900 });
  const f = frame([first, second], 1.4);
  expect(figures(f)[0].note).toBe(first);
  expect(figures(f)[0].outfit.find((g) => g.name === 'gain')!.value).toBe(0);
  expect(figures({ ...f, now: 2.4 })[0].note).toBe(second);
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
  const left = figures(frame([note(1, 2, { pan: 0, gain: 0.2 })], 1.4))[0];
  const right = figures(frame([note(1, 2, { pan: 1, gain: 2 })], 1.4))[0];
  expect(left.x).toBeLessThan(650);
  expect(right.x).toBeGreaterThan(650);
  expect(left.scale).toBeLessThan(right.scale);
});
it('counts every dense note per part without combining identities', () => {
  for (const count of [1, 20]) {
    const f = {
      ...scoreFrame(count),
      now: 0.4,
      notes: Array.from({ length: 500 }, (_, i) =>
        note(i / 500, i / 500 + 0.1, { gain: 1 }, String(i % count)),
      ),
    };
    const cast = figures(f);
    expect(cast).toHaveLength(count);
    expect(cast.reduce((sum, c) => sum + c.members.length, 0)).toBe(500);
    expect(new Set(cast.map((c) => c.instrument.id)).size).toBe(count);
    expect(cast.every((c) => c.x > 0 && c.x < f.width && c.scale > 0)).toBe(true);
  }
});

it('real bar 11 and 12 rotate the cast, use complete sampled bags, and ignore names and Window', () => {
  const cast = figures(real);
  expect(featured(cast)).toHaveLength(1);
  for (const f of cast) {
    expect(f.outfit.map((i) => i.name)).toEqual(Object.keys(f.note!.value).sort());
    expect(f.outfit).toEqual(outfit(f.note!));
  }
  expect(figures({ ...real, now: 11.4 }).find((c) => c.walking)!.instrument.id).not.toBe(
    cast.find((c) => c.walking)!.instrument.id,
  );
  const renamed = figures({
    ...real,
    lookAhead: 10,
    instruments: real.instruments.map((i) => ({ ...i, name: 'renamed' })),
  });
  expect(renamed.map((c) => [c.x, c.y, c.outfit])).toEqual(cast.map((c) => [c.x, c.y, c.outfit]));
});

it('collapses identical query continuations without dropping coincident note onsets', () => {
  const onset = note(0, 2, { gain: 1, note: 48 });
  const fragment = { ...onset, hasOnset: false };
  expect(scoredNotes([fragment, onset, fragment])).toEqual([onset]);
  expect(scoredNotes([onset, onset, fragment])).toEqual([onset, onset]);
  expect(scoredNotes([fragment, fragment])).toEqual([fragment, fragment]);
  expect(scoredNotes([fragment, { ...fragment, value: { gain: 0.5, note: 48 } }])).toHaveLength(2);
});

it('lands steps on scored drum onsets, interpolates six cross-step poses, and falls back to quarters', () => {
  const notes = [0, 0.2, 0.4, 0.6, 0.8].map((t) => note(t, t + 0.05, { s: 'bd' }));
  const score = analyse(notes);
  expect(stepAt(score, 0.2)).toBe(1);
  expect(stepAt(score, 0.3)).toBeCloseTo(1.5);
  expect(stepAt(analyse([note(0, 1, { note: 60 })]), 0.3)).toBe(1.2);
  const poses = Array.from({ length: 6 }, (_, i) => gaitAt(i / 3));
  expect(new Set(poses.map((p) => JSON.stringify(p))).size).toBe(6);
  expect(poses[0].leftX).toBeGreaterThan(0);
  expect(poses[3].rightX).toBeLessThan(0);
  expect(poses[0].leftY).toBe(0);
  expect(poses[3].rightY).toBe(0);
  for (const pose of poses) {
    expect(Math.abs(pose.hips)).toBeLessThanOrEqual(4);
    expect(pose.shoulders).toBe(-pose.hips);
  }
  for (let step = 0; step < 2; step += 0.01) {
    const a = gaitAt(step),
      b = gaitAt(step + 0.001);
    expect(Math.abs(a.leftX - b.leftX)).toBeLessThan(0.1);
    expect(Math.abs(a.rightY - b.rightY)).toBeLessThan(0.1);
  }
  expect(gaitAt(0)).toEqual(gaitAt(2));
  // A regular intro drum cannot keep driving imaginary contacts after its exit.
  const sections = analyse([...notes, note(1.3, 1.31, { s: 'sd' }, '1')]);
  expect(stepAt(sections, 1.3)).toBe(0);
  expect(stepAt(sections, 2.3)).toBeCloseTo(2.3 * 4);
  const drop = analyse([
    ...[0, 1, 10, 11].map((t) => note(t, t + 0.01, { s: 'bd' })),
    ...Array.from({ length: 16 }, (_, i) => note(10 + i / 8, 10 + (i + 1) / 8, { s: 'hh' }, '1')),
  ]);
  expect(stepAt(drop, 10.125)).toBe(1);
});

it('fires every genuine onset, including coincident and dense notes, and fades in 150 ms', () => {
  const notes = [
    note(1, 1.01, { gain: 1 }),
    note(1, 1.01, { gain: 2 }, '1'),
    note(1, 2, {}, '2', false),
    note(1.1, 2),
  ];
  const score = analyse(notes);
  const f = { ...frame(notes), cps: 0.5, instruments: scoreFrame(3).instruments };
  const flashes = cameraFlashes(f, score);
  expect(flashes.map((a) => a.instrument)).toEqual(['0', '1']);
  expect(flashes[0].brightness).toBeLessThan(flashes[1].brightness);
  expect(cameraFlashes({ ...f, now: 1.0375 }, score)[0].brightness).toBeCloseTo(
    flashes[0].brightness / 2,
  );
  expect(cameraFlashes({ ...f, now: 1.076 }, score)).toEqual([]);
  expect(cameraFlashes(f, score)).toEqual(flashes);
  const dense = analyse(Array.from({ length: 500 }, () => note(1, 1.01)));
  const counted = cameraFlashes(f, dense);
  expect(counted.reduce((n, flash) => n + flash.count, 0)).toBe(500);
  expect(counted).toHaveLength(20);
});
