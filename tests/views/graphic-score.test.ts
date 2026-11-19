import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  graphicScore,
  posterLayout,
  readPitch,
  markKind,
} from '../../src/views/graphic-score/model';
import type { ViewFrame, ViewNote } from '../../src/views/types';

const corpus = new Map<string, ViewFrame>();
beforeAll(async () => {
  for (const file of ['real-dubstep-arranged', 'real-techno']) {
    const source = readFileSync(`corpus/programs/${file}.strudel`, 'utf8');
    const state = loadPiece(initialState(), source, importStrudel(source));
    const frame = scoreFrame(state.rows.length);
    frame.sections = state.sections.map((s) => ({
      name: s.name,
      from: s.start,
      to: s.start + s.cycles,
    }));
    frame.to = frame.sections.at(-1)?.to ?? 16;
    const entries = await Promise.all(
      state.rows.map(
        async (row) =>
          [
            row.id,
            await queryEventsNode(generate(state.doc!, { only: row.id }), 0, frame.to),
          ] as const,
      ),
    );
    for (const [, result] of entries) expect(result.error).toBeNull();
    frame.notes = viewNotes({ from: 0, to: frame.to, events: Object.fromEntries(entries) });
    frame.instruments.forEach((i, n) => {
      i.id = state.rows[n].id;
      i.name = state.rows[n].name;
    });
    corpus.set(file, frame);
  }
});
it('draws the entire real arrangement, counts all notes and shows only genuinely moving settings', () => {
  const frame = corpus.get('real-dubstep-arranged')!,
    score = graphicScore(frame);
  expect(score.panels.map((p) => p.to - p.from)).toEqual([4, 4, 8, 4, 8]);
  expect(score.counts).toEqual({
    line: 96,
    dot: 0,
    cross: 241,
    tick: 2,
    zigzag: 200,
    halo: 107,
    carried: 6,
  });
  expect(score.counts.line + score.counts.dot + score.counts.cross + score.counts.tick).toBe(
    score.notes.length,
  );
  for (const n of score.notes) expect(score.marks.some((m) => m.note === n)).toBe(true);
  const wobble = score.parts.find((p) => p.name === 'wobbleBass')!;
  expect(wobble.moving).toEqual([]);
  expect(wobble.heldCutoff).toBeCloseTo(1370);
  expect(score.parts.find((p) => p.name === 'darkPad')!.moving.map((m) => m.name)).toContain(
    'cutoff',
  );
  expect(score.counts.zigzag).toBeGreaterThan(0);
  expect(score.counts.halo).toBeGreaterThan(0);
  expect(score.counts.carried).toBeGreaterThan(0);
  expect(graphicScore({ ...frame, now: 22.7 })).toEqual(score);
  console.log(
    'Graphic score real dubstep mapping:',
    JSON.stringify({
      counts: score.counts,
      notes: score.notes.length,
      segments: score.marks.length,
      moving: score.parts
        .filter((p) => p.moving.length || p.heldCutoff)
        .map((p) => ({ name: p.name, moving: p.moving, heldCutoff: p.heldCutoff })),
    }),
  );
});
it('keeps sample indexes unpitched and real fractional pitches exact', () => {
  const n = (value: ViewNote['value']) => ({
    instrument: '0',
    start: 0,
    end: 1,
    hasOnset: true,
    value,
  });
  expect(readPitch(n({ n: 3, s: 'bd' }))).toBeUndefined();
  expect(readPitch(n({ note: 'eb3', n: 8 }))).toBe(51);
  expect(readPitch(n({ freq: 440 }))).toBe(69);
  expect(readPitch(n({ note: 60.4 }))).toBe(60.4);
  expect([markKind(1 / 32), markKind(1 / 8), markKind(1)]).toEqual(['dot', 'cross', 'tick']);
});
it('preserves coincident onsets, collapses repeated carries and dashes only carried cycle spans', () => {
  const f = scoreFrame();
  f.sections = [{ name: 'A', from: 0, to: 4 }];
  f.now = 1;
  const note: ViewNote = {
    instrument: '0',
    start: 0.25,
    end: 3.5,
    hasOnset: true,
    value: { note: 48, room: 0.8 },
  };
  f.notes = [note, { ...note }, { ...note, hasOnset: false }];
  const score = graphicScore(f);
  expect(score.notes).toHaveLength(2);
  expect(score.marks.filter((m) => m.carried)).toHaveLength(6);
  expect(score.marks.filter((m) => !m.carried)).toHaveLength(2);
  const partial = graphicScore({
    ...f,
    from: 1,
    notes: [
      { ...note, hasOnset: false },
      { ...note, hasOnset: false },
    ],
  });
  expect(partial.notes).toHaveLength(1);
  expect(partial.marks.every((m) => m.carried)).toBe(true);
  expect(partial.marks[0].from).toBe(1);
  expect(partial.marks.at(-1)!.to).toBe(3.5);
});
it('uses proportional time, fixed per-score pitch/rows and bounded narrow labels', () => {
  const f = corpus.get('real-dubstep-arranged')!,
    score = graphicScore(f);
  for (const [width, height] of [
    [1300, 760],
    [1131, 469],
    [559, 675],
  ]) {
    const box = posterLayout(score, width, height);
    expect(box.x(8) - box.x(4)).toBeCloseTo(box.x(4) - box.x(0));
    expect(box.y(60)).toBeLessThan(box.y(48));
    for (const m of score.marks) {
      const y = m.midi === undefined ? box.drumY(m.note.instrument) : box.y(m.midi);
      expect(y).toBeGreaterThanOrEqual(box.top);
      expect(y).toBeLessThan(box.bottom);
      expect(box.x(m.from)).toBeGreaterThanOrEqual(box.left);
      expect(box.x(m.to)).toBeLessThanOrEqual(box.right);
    }
    expect(box.bottom).toBeLessThan(height - box.footer);
  }
});
it('shows four-cycle panels without sections and the absolute repeat without claiming unasked time', () => {
  const f = corpus.get('real-techno')!,
    s = graphicScore(f);
  expect(s.panels.map((p) => [p.from, p.to])).toEqual([
    [0, 4],
    [4, 8],
    [8, 12],
    [12, 16],
  ]);
  expect(
    graphicScore({
      ...f,
      now: 20,
      from: 16,
      to: 32,
      notes: f.notes.map((n) => ({ ...n, start: n.start + 16, end: n.end + 16 })),
    }).counts,
  ).toEqual(s.counts);
  expect(graphicScore({ ...f, now: 20 }).notes).toEqual([]);
});
it('retains 500 notes per cycle, all 20 rows, and moving gain values without a name-derived role', () => {
  const f = scoreFrame(20);
  f.notes = Array.from({ length: 500 }, (_, i) => ({
    instrument: String(i % 20),
    start: 1 + i / 500,
    end: 1 + (i + 1) / 500,
    hasOnset: true,
    value: { n: 3, gain: i / 500 },
  }));
  const s = graphicScore(f),
    box = posterLayout(s, 559, 675);
  expect(s.counts.dot).toBe(500);
  expect(s.counts.zigzag).toBe(500);
  expect(box.drumParts).toHaveLength(20);
  expect(box.pitchLabels).toEqual([]);
  expect(box.drumY(box.drumParts[0].id)).toBeLessThan(box.top + 40);
  expect(box.drumY(box.drumParts[19].id)).toBeGreaterThan(box.bottom - 40);
  expect(new Set(box.drumParts.map((p) => box.drumY(p.id))).size).toBe(20);
  expect(
    graphicScore({
      ...f,
      instruments: f.instruments.map((i) => ({
        ...i,
        name: 'bass',
        muted: true,
        inSection: false,
      })),
    }).marks,
  ).toEqual(s.marks);
});

it('reserves the measured width of the longest full row label at 11 px', () => {
  const score = graphicScore(corpus.get('real-dubstep-arranged')!);
  for (const advance of [6.6, 8.8]) {
    const measure = (text: string) => text.length * advance;
    const box = posterLayout(score, 1131, 469, measure);
    expect(box.drumParts.some((p) => p.name === 'vocalAtmos')).toBe(true);
    for (const part of box.drumParts)
      expect(box.left - 8 - measure(part.name)).toBeGreaterThanOrEqual(box.margin);
    expect(box.right - box.left).toBeGreaterThan(900);
  }
});

it('keeps the compact drum band for one or two drum rows beside a melody', () => {
  for (const drums of [1, 2]) {
    const f = scoreFrame(drums + 1);
    f.notes = f.instruments.map((part, index) => ({
      instrument: part.id,
      start: 0,
      end: 1,
      hasOnset: true,
      value: index === 0 ? { note: 60 } : { s: 'bd' },
    }));
    const score = graphicScore(f);
    for (const [width, height] of [
      [1300, 760],
      [1131, 469],
    ]) {
      const box = posterLayout(score, width, height);
      expect(box.drumParts).toHaveLength(drums);
      expect(box.bottom - box.pitchBottom - 12).toBe(drums * 19 + 16);
    }
  }
});
