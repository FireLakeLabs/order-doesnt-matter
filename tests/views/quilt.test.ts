import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  currentPatch,
  indexQuilt,
  quiltLayout,
  quiltRange,
  ringGeometry,
  ringPoint,
  ringSegment,
  stitchAt,
} from '../../src/views/quilt/model';
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

it('keeps fixed compact section rings, including the late chant, and one patch per real bar', () => {
  const frame = corpus.get('real-dubstep-arranged')!,
    q = indexQuilt(frame);
  expect(q.rows.map((r) => r.instruments.length)).toEqual([3, 4, 6, 3, 6]);
  expect(q.rows.map((r) => r.patches.length)).toEqual([4, 4, 8, 4, 8]);
  expect(q.patches.map((p) => p.bar)).toEqual(Array.from({ length: 28 }, (_, i) => i));
  const chant = frame.instruments.find((i) => i.name === 'preDropVocal')!;
  expect(q.rows[1].instruments).toContain(chant.id);
  expect(
    q.rows[1].patches.map((p) => p.stitches.filter((s) => s.instrument === chant.id).length),
  ).toEqual([0, 0, 0, 1]);
  const renamed = {
    ...frame,
    instruments: frame.instruments
      .map((i) => ({ ...i, name: 'renamed', inSection: false, muted: true }))
      .reverse(),
  };
  expect(indexQuilt(renamed)).toEqual(q);
});
it('finds repeated stitched patterns through the shared change score, ignoring unencoded pitch/settings', () => {
  const frame = corpus.get('real-dubstep-arranged')!,
    q = indexQuilt(frame);
  expect(q.distinct).toBe(8);
  expect(q.patches[8].motif).toBe(q.patches[9].motif);
  expect(q.patches[9].motif).toBe(q.patches[10].motif);
  expect(q.patches[11].motif).not.toBe(q.patches[10].motif);
  expect(q.rows[2].patches.map((p) => p.motif)).toEqual(q.rows[4].patches.map((p) => p.motif));
  expect(new Set(q.patches.map((p) => p.motif)).size).toBe(q.distinct);
  const values = frame.notes.map((n, i) => ({
    ...n,
    value: { note: i, gain: i / 100, cutoff: 100 + i },
  }));
  expect(indexQuilt({ ...frame, notes: values })).toEqual(q);
  const reversed = indexQuilt({ ...frame, notes: frame.notes.slice().reverse() });
  expect(reversed).toEqual(q);
});
it('clips real note spans clockwise and carries a sustained note with no new knot', () => {
  const frame = corpus.get('real-dubstep-arranged')!,
    q = indexQuilt(frame);
  for (const patch of q.patches)
    for (const stitch of patch.stitches) {
      const matches = frame.notes.filter(
        (n) => n.instrument === stitch.instrument && n.start < patch.to && n.end > patch.from,
      );
      expect(
        matches.some(
          (n) =>
            Math.abs(stitch.start - (Math.max(n.start, patch.from) - patch.bar)) < 1e-9 &&
            Math.abs(stitch.end - (Math.min(n.end, patch.to) - patch.bar)) < 1e-9 &&
            stitch.carried === n.start < patch.bar &&
            stitch.onset === (n.hasOnset && n.start >= patch.from),
        ),
      ).toBe(true);
    }
  const vocal = frame.instruments.find((i) => i.name === 'vocalAtmos')!;
  expect(
    q.patches[0].stitches.some((s) => s.instrument === vocal.id && s.onset && !s.carried),
  ).toBe(true);
  expect(q.patches[1].stitches.find((s) => s.instrument === vocal.id)).toMatchObject({
    onset: false,
    carried: true,
    start: 0,
    end: 1,
  });
  expect(ringPoint(10, 0)).toEqual([0, 0]);
  expect(ringPoint(10, 0.25)).toEqual([10, 0]);
  expect(ringPoint(10, 0.5)).toEqual([10, 10]);
  expect(ringPoint(10, 0.75)).toEqual([0, 10]);
  expect(ringPoint(10, 1)).toEqual([0, 0]);
  expect(ringSegment(10, 0.1, 0.9)).toEqual([
    [4, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 4],
  ]);
});
it('uses coverage for scaffolding and absolute repeats without classifying unknown patches as silence', () => {
  const frame = corpus.get('real-dubstep-arranged')!;
  const partial = indexQuilt({ ...frame, from: 8.25, to: 12, notes: [] });
  expect(partial.patches.filter((p) => p.known).map((p) => p.bar)).toEqual([9, 10, 11]);
  expect(partial.patches[8].motif).toBeNull();
  expect(partial.distinct).toBe(1); // confirmed empty, unlike unasked
  const pending = indexQuilt({ ...frame, now: 38.4 });
  expect(pending.patches.every((p) => !p.known)).toBe(true);
  expect(pending.distinct).toBe(0);
  expect(quiltRange({ ...frame, now: 38.4 })).toEqual([28, 56]);
  const repeat = indexQuilt({
    ...frame,
    now: 38.4,
    from: 28,
    to: 56,
    notes: frame.notes.map((n) => ({ ...n, start: n.start + 28, end: n.end + 28 })),
  });
  expect(repeat.distinct).toBe(indexQuilt(frame).distinct);
  expect(currentPatch(repeat, 38.4)).toBe(10);
});
it('creates four-cycle compacting rows without sections and wraps long rows without losing a bar', () => {
  const frame = corpus.get('real-techno')!,
    q = indexQuilt(frame);
  expect(q.rows.map((r) => [r.from, r.to])).toEqual([
    [0, 4],
    [4, 8],
    [8, 12],
    [12, 16],
  ]);
  for (const [width, height] of [
    [1300, 760],
    [1299, 675],
    [559, 675],
    [1131, 469],
  ]) {
    const arranged = indexQuilt(corpus.get('real-dubstep-arranged')!),
      box = quiltLayout(arranged, width, height);
    expect(box.cells).toHaveLength(28);
    expect(box.side).toBeGreaterThan(55);
    expect(
      box.cells.every(
        (c) => c.x + box.side <= width - 20 && c.y + box.side <= height - box.footer + 1,
      ),
    ).toBe(true);
    if (width === 559) expect(box.labels.length).toBeGreaterThan(5);
  }
  const long = indexQuilt({ ...frame, sections: [{ name: 'Long', from: 0, to: 16 }] });
  const box = quiltLayout(long, 559, 675);
  expect(box.labels.length).toBeGreaterThan(1);
  expect(box.cells.map((c) => c.patch.bar)).toEqual(Array.from({ length: 16 }, (_, i) => i));
});
it('retains 500 real-note stitches and every inner instrument in texture above eight rings', () => {
  const frame = corpus.get('real-techno')!,
    f = scoreFrame(20),
    note = frame.notes[0];
  f.now = 1.4;
  f.to = 16;
  f.notes = Array.from({ length: 500 }, (_, i) => ({
    ...note,
    instrument: f.instruments[i % 20].id,
    start: 1 + i / 500,
    end: 1 + (i + 1) / 500,
    hasOnset: true,
  }));
  const q = indexQuilt(f),
    patch = q.patches[1];
  expect(patch.stitches).toHaveLength(500);
  expect(q.rows[0].instruments).toHaveLength(20);
  const box = quiltLayout(q, 559, 471);
  for (let i = 0; i < 20; i++) {
    const ring = ringGeometry(box.side, 20, i);
    expect(ring.length).toBeGreaterThan(0);
    expect(ring.stroke).toBeGreaterThan(0);
    expect(ring.texture).toBe(i >= 7);
  }
  const single = indexQuilt({
    ...f,
    instruments: f.instruments.slice(0, 1),
    notes: f.notes.filter((n) => n.instrument === f.instruments[0].id),
  });
  expect(single.rows[0].instruments).toHaveLength(1);
  expect(ringGeometry(84, 1, 0).texture).toBe(false);
});

it('sews only the elapsed stretch and knots only reached onsets in the current real patch', () => {
  const q = indexQuilt(corpus.get('real-dubstep-arranged')!),
    patch = q.patches[10];
  for (const stitch of patch.stitches) {
    const state = stitchAt(stitch, 0.4);
    expect(state.end).toBeCloseTo(Math.min(stitch.end, 0.4));
    expect(state.knot).toBe(stitch.onset && stitch.start <= 0.4);
    expect(stitchAt(stitch, -1).knot).toBe(false);
    expect(stitchAt(stitch, 1)).toEqual({ end: stitch.end, knot: stitch.onset });
  }
  const snare = patch.stitches.find((s) => s.start === 0.5)!;
  expect(stitchAt(snare, 0.4).knot).toBe(false);
  expect(stitchAt(snare, 0.5).knot).toBe(snare.onset);
  expect(currentPatch(q, 10.4)).toBe(10);
});

it('compares coincident control fragments as the same ink while retaining every source stitch', () => {
  const frame = corpus.get('real-dubstep-arranged')!,
    q = indexQuilt(frame);
  const duplicate = indexQuilt({
    ...frame,
    notes: [...frame.notes, ...frame.notes.map((n) => ({ ...n, hasOnset: false }))],
  });
  expect(duplicate.stitches).toBe(q.stitches * 2);
  expect(duplicate.distinct).toBe(q.distinct);
  expect(duplicate.patches.map((p) => p.motif)).toEqual(q.patches.map((p) => p.motif));
});
