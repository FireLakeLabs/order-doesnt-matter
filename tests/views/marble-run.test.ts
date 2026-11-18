import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  indexMarbles,
  machineLayout,
  machineState,
  marbleAt,
  marbleRadius,
} from '../../src/views/marble-run/model';
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

it('lands the real dubstep snare and hat together at 10.5, 0.1 cycle after the check moment', () => {
  const frame = { ...corpus.get('real-dubstep-arranged')!, lookAhead: 2 };
  const score = indexMarbles(frame.notes),
    machines = machineLayout(frame, score);
  expect(
    ['dubstepDrums · bd', 'dubstepDrums · sd', 'dubstepDrums · hh', 'dubstepDrums · oh'].map(
      (name) => {
        const part = frame.instruments.find((i) => i.name === name)!;
        return machines.find((m) => m.id === part.id)!.targets[0].kind;
      },
    ),
  ).toEqual(['drum', 'drum', 'cymbal', 'cymbal']);
  const landing = frame.notes.filter((n) => n.hasOnset && n.start >= 10.4 && n.start <= 10.5);
  expect(landing.map((n) => frame.instruments.find((i) => i.id === n.instrument)!.name)).toEqual([
    'dubstepDrums · sd',
    'dubstepDrums · hh',
  ]);
  for (const note of landing) {
    const machine = machines.find((m) => m.id === note.instrument)!;
    const target = machine.targets[0];
    expect(marbleAt(note, target, frame).flying).toBe(true);
    expect(marbleAt(note, target, frame).hit).toBe(0);
    const hit = marbleAt(note, target, { ...frame, now: 10.5 });
    expect(hit.flying).toBe(false);
    expect(hit.hit).toBe(1);
    expect(hit.x).toBe(target.x);
    expect(hit.y + hit.radius).toBe(target.y);
  }
  const counts = machines.map((m) => machineState(m, score, frame));
  expect(counts.reduce((n, s) => n + s.flying, 0)).toBe(30);
  expect(counts.reduce((n, s) => n + s.rolling, 0)).toBe(3);
});
it('is independent of names and holds the same target when sibling notes leave', () => {
  const frame = corpus.get('real-dubstep-arranged')!;
  const score = indexMarbles(frame.notes),
    machines = machineLayout(frame, score);
  const renamed = {
    ...frame,
    instruments: frame.instruments.map((i) => ({ ...i, name: 'kick' })).reverse(),
  };
  expect(machineLayout(renamed, score)).toEqual(machines);
  const soundsRenamed = {
    ...renamed,
    notes: frame.notes.map((n) => ({ ...n, value: { ...n.value, s: 'same sound identifier' } })),
  };
  expect(machineLayout(soundsRenamed, indexMarbles(soundsRenamed.notes))).toEqual(machines);
  const note = frame.notes.find((n) => n.value.note === 'eb1' && n.start === 10)!;
  expect(note).toBeDefined();
  const target = machines
    .find((m) => m.id === note.instrument)!
    .targets.find((t) => t.pitch === 27)!;
  const alone = machineLayout({ ...frame, notes: [note] }, indexMarbles([note]));
  expect(alone.find((m) => m.id === note.instrument)!.targets[0]).toEqual(target);
  const p = marbleAt(note, target, frame);
  expect(p.x).toBeCloseTo(target.x + target.length * 0.4);
  expect(marbleAt(note, target, { ...frame, now: note.end }).held).toBe(false);
  const bars = machines.find((m) => m.id === note.instrument)!.targets;
  for (let i = 1; i < bars.length; i++) expect(bars[i].length).toBeGreaterThan(bars[i - 1].length);
});
it('launches exactly one Window early, uses real gain, and never invents fragment onsets', () => {
  const frame = scoreFrame(),
    target = { key: '60', kind: 'bar' as const, pitch: 60, x: 90, y: 300, length: 100 };
  const note = {
    instrument: '0',
    start: 10,
    end: 11.5,
    hasOnset: true,
    value: { note: 60, gain: 0.25 },
  };
  for (const window of [1, 2, 4, 8]) {
    const f = { ...frame, lookAhead: window, now: 10 - window };
    expect(marbleAt(note, target, { ...f, now: f.now - 0.001 }).flying).toBe(false);
    expect(marbleAt(note, target, f)).toMatchObject({ flying: true, x: frame.width / 2, y: 92 });
  }
  expect(marbleRadius({ ...note, value: { gain: 1 } })).toBeGreaterThan(marbleRadius(note));
  const fragment = { ...note, hasOnset: false };
  expect(marbleAt(fragment, target, { ...frame, now: 9.9 })).toMatchObject({
    flying: false,
    hit: 0,
  });
  expect(marbleAt(fragment, target, { ...frame, now: 10.5 })).toMatchObject({
    held: true,
    carried: true,
    hit: 0,
  });
});
it('counts all 500 dense notes as a merged stream and retains simultaneous pitches and fragments', () => {
  const f = scoreFrame(20);
  f.now = 10.4;
  f.lookAhead = 2;
  f.notes = Array.from({ length: 500 }, (_, i) => ({
    instrument: '0',
    start: 10.5 + i / 500,
    end: 11.5 + i / 500,
    hasOnset: true,
    value: { gain: 0.5 },
  }));
  const score = indexMarbles(f.notes),
    machine = machineLayout(f, score)[0],
    state = machineState(machine, score, f);
  expect(state.merged).toBe(true);
  expect(state.flying).toBe(500);
  expect(state.marks.length).toBeLessThan(100);
  expect(state.marks.reduce((n, m) => n + m.count, 0)).toBe(500);
  for (const [width, height] of [
    [1300, 760],
    [559, 675],
  ]) {
    const machines = machineLayout({ ...f, width, height }, score);
    expect(machines).toHaveLength(20);
    expect(machines.slice(1).every((m) => m.targets.length === 0)).toBe(true);
    expect(
      machines.every((m) => m.x >= 0 && m.x + m.width <= width && m.y + m.height <= height - 57),
    ).toBe(true);
  }
  const held = {
    ...f,
    notes: [60, 64, 67].map((p) => ({
      instrument: '0',
      start: 10,
      end: 11,
      hasOnset: false,
      value: { note: p },
    })),
  };
  const heldScore = indexMarbles(held.notes),
    heldMachine = machineLayout(held, heldScore)[0];
  expect(heldMachine.targets).toHaveLength(3);
  expect(machineState(heldMachine, heldScore, held).carried).toBe(3);
});
it('uses the same mapping on the contrasting real techno piece', () => {
  const f = { ...corpus.get('real-techno')!, now: 1.4, lookAhead: 2 },
    score = indexMarbles(f.notes);
  const machines = machineLayout(f, score);
  expect(machines).toHaveLength(4);
  expect(machines.flatMap((m) => m.targets).some((t) => t.kind === 'bar')).toBe(true);
  expect(machines.flatMap((m) => m.targets).some((t) => t.kind === 'drum')).toBe(true);
  expect(machines.reduce((n, m) => n + machineState(m, score, f).flying, 0)).toBeGreaterThan(0);
});
