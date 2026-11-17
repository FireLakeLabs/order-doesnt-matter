import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { noteProgress } from '../../src/views/shared/timing';
import {
  analyse,
  crowded,
  fontSize,
  gain,
  hop,
  layout,
  lyrics,
  previewFontSize,
  text,
} from '../../src/views/karaoke/model';
import { scoreFrame } from './score-fixture';
import type { ViewFrame, ViewNote } from '../../src/views/types';
let real: ViewFrame;
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
    state = loadPiece(initialState(), source, importStrudel(source));
  const results = await Promise.all(
    state.rows.map(
      async (row) =>
        [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 4, 20)] as const,
    ),
  );
  for (const [, result] of results) expect(result.error).toBeNull();
  const score = { from: 4, to: 20, events: Object.fromEntries(results) };
  real = buildFrame({ ...scoreFrame(), state, score, notes: viewNotes(score) });
});
const note = (
  start: number,
  end: number,
  value: Record<string, unknown> = {},
  hasOnset = true,
): ViewNote => ({ instrument: '0', start, end, value, hasOnset });
const metrics = (text: string, size: number) => text.length * size * 0.6;
it('uses the shared pitch reader before sound names, including frequency and fractional pitches', () => {
  expect(text(note(0, 1, { note: 'eb2', s: 'sawtooth' }))).toBe('D#2');
  expect(text(note(0, 1, { s: 'bd' }))).toBe('bd');
  expect(text(note(0, 1, { n: 60 }))).toBe('C4');
  expect(text(note(0, 1, { freq: 440 }))).toBe('A4');
  expect(text(note(0, 1, { note: 48.3 }))).toBe('C3 +0.3');
  expect(text(note(0, 1))).toBe('note');
});
it('retains every continuation span without making duplicate words or invented landings', () => {
  const onset = note(0, 1, { note: 'eb2', gain: 0.75 }),
    fragment = { ...onset, hasOnset: false };
  const part = analyse([fragment, onset, fragment]).get('0')!;
  expect(part.words.map((w) => w.text)).toEqual(['D#2']);
  expect(part.words[0].spans).toHaveLength(3);
  expect(part.onsets).toHaveLength(1);
  const unison = analyse([onset, onset, fragment]).get('0')!;
  expect(unison.words).toHaveLength(2);
  expect(unison.words.reduce((n, w) => n + w.spans.length, 0)).toBe(3);
  const held = analyse([fragment, fragment]).get('0')!;
  expect(held.words).toHaveLength(1);
  expect(held.onsets).toHaveLength(0);
});
it('sets words and length to actual fractional times, and uses scored span progress for the wipe', () => {
  const n = note(10.375, 10.5, { s: 'hh' }),
    g = layout(scoreFrame(), 6),
    word = analyse([n]).get('0')!.words[0];
  expect(g.x(n.start, 10)).toBeCloseTo(g.left + 0.375 * (g.right - g.left));
  expect(g.x(n.end, 10) - g.x(n.start, 10)).toBeCloseTo(0.125 * (g.right - g.left));
  expect(noteProgress(word.note, 10.4)).toBeCloseTo(0.2);
  expect(noteProgress(word.note, 10.5)).toBe(1);
  expect(noteProgress(word.note, 10.3)).toBe(0);
  const long = note(9.5, 11.5);
  const song = lyrics({ ...scoreFrame(), now: 10.4 }, analyse([long]));
  expect(song.rows[0].words[0].note.start).toBe(9.5);
  expect(song.rows[0].next).toHaveLength(1);
  expect(noteProgress(long, 10.4)).toBeCloseTo(0.45);
});
it('lands on every onset, including irregular gaps, and never bounces on a continuation', () => {
  const notes = [
    note(0, 0.1),
    note(0.375, 0.5),
    note(0.75, 0.8),
    note(0.5, 0.6, {}, false),
    note(1, 1.2),
  ];
  const part = analyse(notes).get('0')!,
    g = layout(scoreFrame(), 6);
  for (const now of [0, 0.375, 0.75, 1]) expect(hop(part, '0', now, g)!.rise).toBe(0);
  const midpoint = hop(part, '0', 0.1875, g)!;
  expect(midpoint.progress).toBe(0.5);
  expect(midpoint.rise).toBe(midpoint.height);
  expect(midpoint.next!.start).toBe(0.375);
  const before = hop(part, '0', 0.5, g)!;
  expect(before.previous.start).toBe(0.375);
  expect(before.next!.start).toBe(0.75);
  expect(hop(part, '0', -0.1, g)).toBeUndefined();
  expect(hop(part, '0', 2, g)).toMatchObject({ next: undefined, time: 1, rise: 0 });
  expect(hop(part, '0', 0.8, g)!.height).toBeLessThan(midpoint.height);
});
it('gain changes size, with finite fallbacks and stage-scaled main marks', () => {
  for (const size of [
    { width: 1300, height: 760 },
    { width: 1131.25, height: 469.09375 },
    { width: 560, height: 760 },
    { width: 560, height: 675 },
  ]) {
    const g = layout(size, 6);
    expect(fontSize(g, 1)).toBeGreaterThanOrEqual((26 * size.width) / 960);
    expect(g.nameSize).toBeGreaterThanOrEqual(12);
    expect(previewFontSize(g, 1)).toBeGreaterThanOrEqual(previewFontSize(g, 0.2));
    expect(fontSize(g, 1)).toBeGreaterThanOrEqual(fontSize(g, 0.2));
  }
  expect(gain(note(0, 1, { gain: NaN }))).toBe(1);
  expect(gain(note(0, 1, { gain: -2 }))).toBe(0);
});
it('finds the real verse and bass lyrics from notes regardless of instrument names or playback flags', () => {
  const score = analyse(real.notes),
    song = lyrics(real, score);
  expect(song.section?.name).toBe('drop');
  expect(song.sectionBar).toBe(3);
  expect(song.sectionBars).toBe(8);
  const bass = song.rows.find((r) => r.instrument.name === 'subBass')!,
    wobble = song.rows.find((r) => r.instrument.name === 'wobbleBass')!;
  expect(bass.words.map((w) => w.text)).toEqual(['D#1']);
  expect(wobble.words.map((w) => w.text)).toEqual(['D#2']);
  expect(wobble.words[0].spans).toHaveLength(3);
  expect(wobble.part.onsets.filter((n) => n.start === 10)).toHaveLength(1);
  expect(bass.next.map((w) => w.text)).toEqual(['F1', 'G1']);
  expect(wobble.next.map((w) => w.text)).toEqual(['F2', 'G2']);
  const renamed = lyrics(
    {
      ...real,
      playing: false,
      instruments: real.instruments.map((i) => ({ ...i, name: 'anything', sounding: false })),
    },
    score,
  );
  expect(renamed.rows.map((r) => r.words)).toEqual(song.rows.map((r) => r.words));
  expect(lyrics({ ...real, now: 38.4 }, score).section?.name).toBe('drop');
});
it('turns the real hat line into dots when crowded while keeping every word and raw span', () => {
  const song = lyrics(real, analyse(real.notes)),
    hats = song.rows.find((r) => r.instrument.name === 'hh · drop')!;
  expect(hats.words).toHaveLength(8);
  expect(crowded(hats.words, song.bar, layout({ width: 1300, height: 760 }, 6), metrics)).toBe(
    false,
  );
  expect(crowded(hats.words, song.bar, layout({ width: 560, height: 760 }, 6), metrics)).toBe(true);
  expect(hats.words.reduce((n, w) => n + w.spans.length, 0)).toBe(8);
});
it('keeps all 500 notes per cycle and twenty instrument lines, with a dense next line', () => {
  const f = {
    ...scoreFrame(20),
    notes: Array.from({ length: 20 }, (_, i) =>
      Array.from({ length: 1000 }, (_, j) => ({
        ...note(10 + j / 500, 10 + (j + 1) / 500, { s: 'hh' }),
        instrument: String(i),
      })),
    ).flat(),
  };
  const score = analyse(f.notes),
    song = lyrics(f, score),
    g = layout(f, 20);
  expect(song.rows).toHaveLength(20);
  expect(song.rows.every((r) => r.words.length === 500 && r.next.length === 500)).toBe(true);
  expect(song.rows.every((r) => crowded(r.words, 10, g, metrics))).toBe(true);
  expect(
    [...score.values()].reduce((n, p) => n + p.words.reduce((s, w) => s + w.spans.length, 0), 0),
  ).toBe(20000);
  expect(lyrics({ ...f, from: 4, to: 11 }, score).nextKnown).toBe(false);
});
it('uses only the frame when scrubbing in any order and does not alter the score', () => {
  const score = analyse(real.notes),
    before = lyrics(real, score),
    part = before.rows[0].part,
    g = layout(real, before.rows.length),
    ball = hop(part, before.rows[0].instrument.id, real.now, g);
  lyrics({ ...real, now: 17.9 }, score);
  lyrics({ ...real, now: 4.1 }, score);
  expect(lyrics(real, score)).toEqual(before);
  expect(hop(part, before.rows[0].instrument.id, real.now, g)).toEqual(ball);
  expect(
    [...score.values()].reduce(
      (sum, p) => sum + p.words.reduce((n, w) => n + w.spans.length, 0),
      0,
    ),
  ).toBe(real.notes.length);
});

it('keeps long-gap hops within the line budget instead of sending a ball off stage', () => {
  const g = layout(scoreFrame(), 1),
    part = analyse([note(0, 64), note(64, 65)]).get('0')!;
  expect(hop(part, '0', 32, g)!.height).toBeLessThanOrEqual(g.rowHeight * 0.6);
});

it('sets the combined next cue at real starts and applies the same crowd rule to overlapping instruments', () => {
  const song = lyrics(real, analyse(real.notes)),
    next = song.rows.flatMap((r) => r.next).sort((a, b) => a.note.start - b.note.start),
    g = layout(real, song.rows.length);
  expect(next).toHaveLength(16);
  expect(next.filter((w) => w.text === 'F1' || w.text === 'F2').map((w) => w.note.start)).toEqual([
    11, 11,
  ]);
  expect(
    crowded(next, 11, { ...g, rowHeight: 32 }, metrics, (value) => previewFontSize(g, value)),
  ).toBe(true);
  expect(
    song.rows.find((r) => r.instrument.name === 'subBass')!.next.map((w) => g.x(w.note.start, 11)),
  ).toEqual([g.left, g.left + (g.right - g.left) / 2]);
});
