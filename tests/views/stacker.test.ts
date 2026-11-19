import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  indexStacker,
  stackAt,
  stackerLayout,
  notePatches,
  stackerRange,
} from '../../src/views/stacker/model';
import type { ViewFrame } from '../../src/views/types';

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

it('reports the real dubstep prefix at bar eleven without manufacturing repeats', () => {
  const score = indexStacker(corpus.get('real-dubstep-arranged')!);
  const state = stackAt(score, 10.4, 12);
  expect(score.pieces).toHaveLength(28);
  expect(state.stack).toHaveLength(10);
  expect(state.clears).toEqual([]);
  expect(state.current?.bar).toBe(10);
  expect(state.current?.notes).toHaveLength(16);
  expect(state.next?.bar).toBe(11);
  expect(stackAt(score, 27.4, 12).next?.bar).toBe(0);
  expect(state.phase).toBeCloseTo(0.4);
  expect(
    score.pieces.filter((p) => p.match !== null).map((p) => [p.bar + 1, p.match! + 1]),
  ).toEqual(Array.from({ length: 8 }, (_, i) => [21 + i, 9 + i]));
  for (const piece of score.pieces) {
    const patches = score.order.flatMap((id) => notePatches(piece, id, 600));
    expect(patches.reduce((n, p) => n + p.count, 0)).toBe(piece.notes.length);
    for (const n of piece.notes) expect(n.start >= 0 && n.end <= 1).toBe(true);
  }
});
it('clears only exact nonadjacent multisets including every setting, pitch, timing and multiplicity', () => {
  const f = scoreFrame();
  f.sections = [{ name: 'Test', from: 0, to: 8 }];
  f.now = 2.4;
  const n = {
    instrument: '0',
    start: 0,
    end: 0.25,
    hasOnset: true,
    value: { note: 'c3', gain: 0.7, lpf: 1370 },
  };
  f.notes = Array.from({ length: 8 }, (_, i) => ({
    ...n,
    start: i,
    end: i + 0.25,
    value: { ...n.value },
  }));
  f.notes[1].value.gain = 0.8;
  f.notes[3].value.note = 'd3';
  f.notes[4].end += 0.1;
  f.notes[5].hasOnset = false;
  f.notes.push({ ...f.notes[6] });
  // Property order and source order have no effect on exact comparison.
  f.notes[7].value = { lpf: 1370, gain: 0.7, note: 'c3' };
  f.notes.reverse();
  const score = indexStacker(f);
  expect(score.pieces.map((p) => p.match)).toEqual([null, null, 0, null, null, null, null, 0]);
  const before = stackAt(score, 2.999, 2),
    after = stackAt(score, 3, 2);
  expect(before.clears).toHaveLength(0);
  expect(after.clears.map((p) => [p.bar, p.match])).toEqual([[2, 0]]);
  expect(after.stack.map((p) => p.bar)).toEqual([0, 1]);
  expect(after.flash?.match).toBe(0);
  expect(stackAt(score, 3.29, 2).flash).toBeUndefined();
  expect(stackAt(score, 8, 2).buried).toBe(4);
  expect(stackAt(score, 8, 2).visible.map((p) => p.bar)).toEqual([5, 6]);
  expect(stackAt(score, 3, 2)).toEqual(after);
});
it('distinguishes unasked coverage from silence and compares across buried material', () => {
  const f = scoreFrame();
  f.sections = [{ name: 'Test', from: 0, to: 8 }];
  f.now = 2.4;
  f.from = 2.25;
  f.to = 6;
  const score = indexStacker(f);
  expect(score.pieces.map((p) => p.known)).toEqual([
    false,
    false,
    false,
    true,
    true,
    true,
    false,
    false,
  ]);
  expect(score.pieces[3].match).toBeNull();
  expect(score.pieces[5].match).toBe(3);
  expect(stackAt(score, 6, 1).unknown).toBe(3);
  expect(stackerRange({ ...f, now: 18.4 })).toEqual([16, 24]);
});
it('keeps every dense note counted, every part row stable, and the well inside all stages', () => {
  const f = scoreFrame(20);
  f.notes = Array.from({ length: 500 }, (_, i) => ({
    instrument: String(i % 20),
    start: 10 + i / 500,
    end: 10 + (i + 1) / 500,
    hasOnset: true,
    value: { n: i },
  }));
  const score = indexStacker(f),
    piece = score.pieces[10];
  expect(piece.notes).toHaveLength(500);
  expect(score.order).toEqual(f.instruments.map((i) => i.id));
  expect(
    score.order.flatMap((id) => notePatches(piece, id, 150)).reduce((sum, p) => sum + p.count, 0),
  ).toBe(500);
  for (const [w, h] of [
    [1300, 760],
    [1131, 469],
    [559, 469],
    [559, 675],
  ]) {
    const b = stackerLayout(w, h, 20);
    expect(b.x).toBeGreaterThan(0);
    expect(b.x + b.wellWidth).toBeLessThan(w);
    expect(b.bottom).toBeLessThan(h);
    expect(b.bottom - (b.capacity + 1) * b.pieceHeight).toBeGreaterThan(b.top);
  }
});

it('draws solid-height ragged forms with exact span edges and deterministic part lanes', async () => {
  const { drawingLayout, pieceForm } = await import('../../src/views/stacker/drawing');
  const frame = corpus.get('real-dubstep-arranged')!,
    score = indexStacker(frame);
  const piece = score.pieces[10],
    form = pieceForm(piece, score.order, 600);
  expect(form.rows).toBe(6);
  expect(form.blocks.reduce((sum, b) => sum + b.count, 0)).toBe(16);
  for (const block of form.blocks) {
    expect(block.lane).toBe(score.order.indexOf(block.instrument) % 6);
    expect(
      piece.notes.some((n) => n.instrument === block.instrument && n.start === block.start),
    ).toBe(true);
    expect(piece.notes.some((n) => n.instrument === block.instrument && n.end === block.end)).toBe(
      true,
    );
  }
  // The kick's rest stays a real gap, not a full-width piece enclosure.
  const short = form.blocks.find((b) => b.end - b.start < 0.2)!;
  expect(short.end - short.start).toBeLessThan(0.2);
  const withoutSiblings = pieceForm(
    { ...piece, notes: piece.notes.filter((n) => n.instrument === short.instrument) },
    score.order,
    600,
  );
  expect(withoutSiblings.blocks[0].lane).toBe(short.lane);
  for (const [w, h] of [
    [1300, 760],
    [1131, 469],
    [559, 675],
    [559, 469],
  ]) {
    const d = drawingLayout(score, 10.4, w, h);
    expect(d.cell).toBeGreaterThanOrEqual(14);
    expect(d.state.stack).toHaveLength(10);
    expect(d.state.visible.length + d.state.buried).toBe(10);
    expect(d.landing).toBeGreaterThan(d.top);
    expect(d.stackTop).toBeGreaterThanOrEqual(d.top);
    expect(
      d.placed.every((p) => p.y >= d.top && p.y + p.form.rows * d.cell <= d.bottom + 1e-8),
    ).toBe(true);
  }
});
it('collapses only the transient incoming repeat while the unchanged prefix drops into place', async () => {
  const { drawingLayout } = await import('../../src/views/stacker/drawing');
  const score = indexStacker(corpus.get('real-dubstep-arranged')!);
  const early = drawingLayout(score, 21.04, 1131, 469);
  const middle = drawingLayout(score, 21.16, 1131, 469);
  const done = drawingLayout(score, 21.3, 1131, 469);
  expect(early.lift).toBeGreaterThan(middle.lift);
  expect(middle.lift).toBeGreaterThan(0);
  expect(done.lift).toBe(0);
  expect(middle.state.clears.map((p) => [p.bar, p.match])).toEqual([[20, 8]]);
  expect(middle.state.stack).toHaveLength(20);
  expect(middle.state.stack).toEqual(done.state.stack);
  expect(drawingLayout(score, 21.16, 1131, 469)).toEqual(middle);
});
