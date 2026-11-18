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
  runGeometry,
  pitchY,
} from '../../src/views/marble-run/model';
import { scoredNotes } from '../../src/views/shared/scored-notes';
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
    frame.from = file === 'real-dubstep-arranged' ? 4 : 0;
    frame.to = file === 'real-dubstep-arranged' ? 18 : 16;
    const entries = await Promise.all(
      state.rows.map(
        async (row) =>
          [
            row.id,
            await queryEventsNode(generate(state.doc!, { only: row.id }), frame.from, frame.to),
          ] as const,
      ),
    );
    for (const [, result] of entries) expect(result.error).toBeNull();
    frame.notes = viewNotes({
      from: frame.from,
      to: frame.to,
      events: Object.fromEntries(entries),
    });
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
    target = {
      key: '60',
      kind: 'bar' as const,
      pitch: 60,
      x: 90,
      y: 300,
      length: 100,
      thickness: 4,
      station: null,
    };
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
    expect(marbleAt(note, target, f)).toMatchObject({
      flying: true,
      x: runGeometry(frame).hopperX,
      y: runGeometry(frame).hopperY,
    });
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
      machines
        .flatMap((m) => m.targets)
        .every(
          (t) =>
            t.x >= 0 &&
            t.x + t.length <= width &&
            t.y >= 0 &&
            t.y <= runGeometry({ ...f, width, height }).floor,
        ),
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

it('counts onset notes once while preserving genuine unisons, changed bags and unmatched carries', () => {
  const f = scoreFrame(),
    n = { instrument: '0', start: 10, end: 12, hasOnset: true, value: { note: 39, gain: 0.75 } };
  const repeated = { ...n, hasOnset: false, value: { gain: 0.75, note: 39 } };
  expect(scoredNotes([n, repeated, repeated])).toEqual([n]);
  expect(scoredNotes([n, n, repeated])).toEqual([n, n]);
  const changed = { ...repeated, value: { note: 39, gain: 0.5 } };
  expect(scoredNotes([n, changed])).toEqual([n, changed]);
  expect(scoredNotes([repeated])).toEqual([repeated]);
  f.notes = [n, ...Array.from({ length: 40 }, () => repeated)];
  const s = indexMarbles(f.notes),
    m = machineLayout(f, s)[0],
    state = machineState(m, s, f);
  expect(state.rolling).toBe(1);
  expect(state.carried).toBe(0);
  expect(state.marks).toHaveLength(1);
  expect(state.merged).toBe(false);
  const carry = indexMarbles([repeated]);
  expect(machineState(machineLayout(f, carry)[0], carry, f).carried).toBe(1);
});
it('separates octave bars without wrapping and keeps the label column clear of every bar and rolling marble', () => {
  for (const [width, height] of [
    [1131, 469],
    [1300, 760],
    [560, 675],
  ]) {
    const f = { ...scoreFrame(), width, height };
    f.notes = [24, 27, 36, 39, 48, 51, 60, 72, 84].map((note) => ({
      instrument: '0',
      start: 10,
      end: 11,
      hasOnset: true,
      value: { note },
    }));
    const s = indexMarbles(f.notes),
      m = machineLayout(f, s)[0],
      box = runGeometry(f);
    expect(Math.abs(pitchY(24, f) - pitchY(72, f))).toBeGreaterThan(40);
    expect(Math.abs(pitchY(39, f) - pitchY(51, f))).toBeGreaterThan(15);
    for (const t of m.targets) {
      expect(box.labelX - 2).toBeGreaterThan(t.x + t.length + 15);
      expect(t.y).toBeLessThan(box.floor - 20);
    }
    const held = f.notes[3],
      target = m.targets.find((t) => t.pitch === 39)!;
    const alone = machineLayout({ ...f, notes: [held] }, indexMarbles([held]))[0].targets[0];
    expect(alone).toEqual(target);
  }
});
it('uses fourteen-cycle evidence for percussion shape without moving the station when that evidence changes', () => {
  const f = scoreFrame();
  const sparse = {
    ...f,
    from: 0,
    to: 14,
    notes: Array.from({ length: 14 }, (_, i) => ({
      instrument: '0',
      start: i,
      end: i + 0.5,
      hasOnset: true,
      value: {},
    })),
  };
  const dense = {
    ...f,
    from: 8,
    to: 22,
    notes: Array.from({ length: 112 }, (_, i) => ({
      instrument: '0',
      start: 8 + i / 8,
      end: 8 + (i + 1) / 8,
      hasOnset: true,
      value: {},
    })),
  };
  const a = machineLayout(sparse, indexMarbles(sparse.notes))[0].targets[0],
    b = machineLayout(dense, indexMarbles(dense.notes))[0].targets[0];
  expect(a.kind).toBe('drum');
  expect(b.kind).toBe('cymbal');
  expect([a.x, a.y, a.length]).toEqual([b.x, b.y, b.length]);
});
