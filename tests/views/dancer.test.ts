import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  cutoff,
  dancerLayout,
  envelope,
  indexDancer,
  noteSeed,
  poseAt,
  roleMembers,
} from '../../src/views/dancer/model';
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
function windowFrame(frame: ViewFrame, now: number) {
  return {
    ...frame,
    now,
    notes: frame.notes.filter(
      (n) =>
        n.start < Math.floor(now / 4) * 4 + 12 && n.end > Math.max(0, Math.floor(now / 4) * 4 - 4),
    ),
  };
}
it('combines the real drop at 10.4: three notes, held bass hips, hats hand, cutoff arms, planted feet and no invented pan', () => {
  const frame = windowFrame(corpus.get('real-dubstep-arranged')!, 10.4);
  const score = indexDancer(frame.notes),
    state = poseAt(score, frame.now);
  const name = (id: string) => frame.instruments.find((i) => i.id === id)!.name;
  expect(state.layers.map((l) => name(l.note.instrument)).sort()).toEqual([
    'dubstepDrums · hh',
    'subBass',
    'wobbleBass',
  ]);
  expect(state.counts).toEqual({ feet: 0, head: 0, hands: 1, hips: 1, arms: 1, torso: 0 });
  expect(state.pose.feet).toEqual([0, 0]);
  expect(state.pose.torso).toBe(0);
  expect(Math.abs(state.pose.hips)).toBeGreaterThan(0.5);
  expect(Math.max(...state.pose.hands)).toBeGreaterThan(0.3);
  const arms = state.layers.find((l) => l.roles.includes('arms'))!;
  expect(cutoff(arms.note)).toBeCloseTo(1370, 5);
  expect(arms.armTarget).toBeGreaterThan(0.5);
  expect([...state.tiles.values()].flat()).toHaveLength(3);
  expect(roleMembers(score, frame, 'feet').map(name).sort()).toEqual([
    'dubstepDrums · bd',
    'dubstepDrums · sd',
  ]);
});
it('reads roles from note evidence even after names and sample identifiers change', () => {
  for (const file of corpus.keys()) {
    const frame = windowFrame(corpus.get(file)!, 10.4),
      score = indexDancer(frame.notes);
    const renamed = frame.notes.map((n) => ({ ...n, value: { ...n.value, s: 'unrelated' } }));
    expect(indexDancer(renamed).parts).toEqual(score.parts);
    const techno = file === 'real-techno';
    if (techno) {
      expect(
        roleMembers(score, frame, 'feet').map(
          (id) => frame.instruments.find((i) => i.id === id)!.index,
        ),
      ).toEqual([0]);
      expect(roleMembers(score, frame, 'hands')).toHaveLength(2);
    }
  }
});
const note = (
  instrument: string,
  start: number,
  end: number,
  value: ViewNote['value'] = {},
): ViewNote => ({ instrument, start, end, value, hasOnset: true });
it('uses real spans with smooth boundaries, constant sampled cutoff targets, and neutral silence', () => {
  const n = note('bass', 2.37, 4.91, { note: 'c2', cutoff: 1370, pan: 0.9 });
  const score = indexDancer([n]);
  for (const p of [0.2, 0.4, 0.7]) {
    const pose = poseAt(score, n.start + p * (n.end - n.start));
    expect(pose.pose.arms).toBeCloseTo(pose.layers[0].armTarget!);
    expect(pose.pose.torso).toBeCloseTo(0.8);
  }
  expect(envelope(n, n.start)).toBe(0);
  expect(envelope(n, n.end)).toBe(0);
  for (const t of [n.start - 0.01, n.end, n.end + 2]) {
    expect(poseAt(score, t).layers).toHaveLength(0);
    expect(poseAt(score, t).pose).toEqual({
      feet: [0, 0],
      hands: [0, 0],
      hips: 0,
      head: 0,
      arms: 0,
      torso: 0,
    });
  }
  const nearStart = poseAt(score, n.start + 0.000001).pose;
  const nearEnd = poseAt(score, n.end - 0.000001).pose;
  expect(nearStart.arms).toBeLessThan(1e-9);
  expect(nearEnd.arms).toBeLessThan(1e-9);
  // A non-onset fragment can still hold a limb; it does not invent an earlier snap.
  expect(poseAt(indexDancer([{ ...n, hasOnset: false }]), 3).counts.hips).toBe(1);
});
it('adds colliding roles and accounts for 500 coincident notes across twenty parts, with fixed cells and sides', () => {
  const notes = Array.from({ length: 500 }, (_, i) =>
    note(String(i % 20), 0, 1, { note: (i % 3) + 36, cutoff: 400 + i, pan: 0.7 }),
  );
  const score = indexDancer(notes),
    state = poseAt(score, 0.4);
  expect(state.layers).toHaveLength(500);
  expect(state.counts.arms).toBe(500);
  expect(state.counts.torso).toBe(500);
  expect([...state.tiles.values()].flat()).toHaveLength(500);
  expect(state.tiles.size).toBeLessThanOrEqual(24);
  expect(state.pose.arms).toBe(1);
  expect(state.pose.torso).toBe(1);
  for (const layer of state.layers) {
    expect(layer.cell).toBe(noteSeed(layer.note) % 24);
    expect(layer.side).toBe(noteSeed(layer.note) % 2);
  }
  const held = note('held', 0, 2, { note: 'c1' });
  const siblings = [held, note('held', 0, 0.5, { note: 'g1' })];
  const before = poseAt(indexDancer(siblings), 0.49).layers.find((l) => l.note === held)!;
  const after = poseAt(indexDancer(siblings), 0.51).layers.find((l) => l.note === held)!;
  expect([before.cell, before.side]).toEqual([after.cell, after.side]);
});
it('leaves missing limbs neutral, gives extra parts tiles, and is independent of evaluation order', () => {
  const notes = [note('low', 0, 2, { note: 'c1' }), note('extra', 0.25, 1.5, { note: 'c5' })];
  const score = indexDancer(notes),
    before = poseAt(score, 0.7);
  expect(before.layers.find((l) => l.note.instrument === 'extra')!.roles).toEqual([]);
  expect(before.counts).toEqual({ feet: 0, head: 0, hands: 0, hips: 1, arms: 0, torso: 0 });
  for (const t of [1.7, 0.2, 99, -1]) poseAt(score, t);
  expect(poseAt(score, 0.7)).toEqual(before);
  expect(poseAt(indexDancer([]), 0).layers).toEqual([]);
  expect(cutoff(note('bad', 0, 1, { lpf: NaN }))).toBeUndefined();
});
it('keeps figure and text in separate bands at Studio sizes, including narrow Stage B', () => {
  for (const [width, height] of [
    [1300, 760],
    [1131, 469],
    [559, 675],
    [560, 469],
  ]) {
    const box = dancerLayout(width, height);
    expect(box.y).toBeGreaterThan(60);
    expect(box.y + box.scale * 430).toBeLessThanOrEqual(height - box.footer);
    expect(box.x - box.scale * 300).toBeGreaterThanOrEqual(16);
    expect(box.x + box.scale * 300).toBeLessThanOrEqual(width - 16);
  }
});

it('normalizes query continuations without losing coincident onsets or distinct settings; mute means neutral', () => {
  const n = note('voice', 0, 1, { note: 'c2', lpf: 1370 });
  const fragment = { ...n, hasOnset: false };
  expect(indexDancer([n, fragment, fragment]).notes).toHaveLength(1);
  expect(indexDancer([n, n, fragment]).notes).toHaveLength(2);
  expect(indexDancer([fragment, fragment]).notes).toHaveLength(1);
  expect(indexDancer([fragment, { ...fragment, value: { note: 'g2' } }]).notes).toHaveLength(2);
  const state = poseAt(indexDancer([n]), 0.4, new Set(['voice']));
  expect(state.layers).toHaveLength(0);
  expect(state.pose.arms).toBe(0);
  expect(state.pose.hips).toBe(0);
});

it('never mistakes sample indices for the lowest pitched part', () => {
  const notes = [note('vocal', 0, 4, { s: 'sample', n: 0 }), note('sub', 0, 1, { note: 'eb1' })];
  const state = poseAt(indexDancer(notes), 0.4);
  expect(state.layers.find((l) => l.roles.includes('hips'))?.note.instrument).toBe('sub');
  expect(state.layers.find((l) => l.note.instrument === 'vocal')?.roles).toEqual([]);
});
