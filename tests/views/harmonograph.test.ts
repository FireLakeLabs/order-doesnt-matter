import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import {
  analyse,
  intervalName,
  layout,
  pair,
  pairing,
  pitchLabel,
  sounding,
  trace,
} from '../../src/views/harmonograph/model';
import type { ViewNote } from '../../src/views/types';
import { scoreFrame } from './score-fixture';
let notes: ViewNote[], ids: string[];
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  ids = state.rows.map((r) => r.id);
  const entries = await Promise.all(
    state.rows.map(async (row) => {
      const result = await queryEventsNode(generate(state.doc!, { only: row.id }), 0, 28);
      expect(result.error).toBeNull();
      return [row.id, result] as const;
    }),
  );
  notes = viewNotes({ from: 0, to: 28, events: Object.fromEntries(entries) });
});
function frame(now: number) {
  const f = scoreFrame(ids.length);
  f.instruments.forEach((i, n) => {
    i.id = ids[n];
    i.name = 'renamed';
  });
  return { ...f, now, notes };
}
it('uses the real outer voices at bar18 and retains all five other pairs', () => {
  const set = pairing(sounding(frame(17.3), analyse(notes)));
  expect(set.main?.low.midi).toBe(44);
  expect(set.main?.high.midi).toBe(63);
  expect(pitchLabel(set.main!.low.midi)).toBe('A♭2');
  expect(pitchLabel(set.main!.high.midi)).toBe('E♭4');
  expect(set.main?.ratio).toBeCloseTo(2.996614153753363, 10);
  expect(set.main?.approximation).toBe('3 : 1');
  expect(set.main?.interval).toBe('perfect twelfth');
  expect(set.count).toBe(6);
  expect(set.others).toHaveLength(5);
  expect(set.others.map((p) => p.pair.shortName)).toEqual(['P5', 'M10', 'M6', 'P8', 'm3']);
  expect(pairing(sounding(frame(17.3), analyse([...notes].reverse())))).toEqual(set);
});
it('measures the real drop’s octave rather than mistaking sample n for bass', () => {
  const set = pairing(sounding(frame(10.4), analyse(notes)));
  expect([set.main?.low.midi, set.main?.high.midi]).toEqual([27, 39]);
  expect([set.main?.low.hz, set.main?.high.hz]).toEqual([
    440 * 2 ** ((27 - 69) / 12),
    440 * 2 ** ((39 - 69) / 12),
  ]);
  expect(set.main?.ratio).toBe(2);
  expect(set.main?.interval).toBe('octave');
  expect(set.others).toEqual([]);
  expect(analyse(notes.filter((n) => n.value.s === 'ade'))).toEqual([]);
});
it('winds from the shorter scored note, including exact starts/ends and reversible seeks', () => {
  const tones = analyse(notes),
    main = pairing(sounding(frame(17.3), tones)).main!;
  expect(main.shorter.start).toBe(17.25);
  expect(main.shorter.end).toBe(17.375);
  const at = trace(main, 17.3);
  expect(at.progress).toBeCloseTo(0.4);
  expect(at.envelope).toBeCloseTo(0.42 ** 0.4);
  expect(trace(main, 17.25).points).toHaveLength(2);
  trace(main, 26);
  trace(main, -2);
  expect(trace(main, 17.3)).toEqual(at);
  const after = pairing(sounding(frame(17.375), tones));
  expect(after.main?.high.midi).toBe(60);
  expect(trace(main, 18).progress).toBe(1);
});
it('never snaps a slightly imperfect scored ratio to the simple ratio printed beside it', () => {
  const main = pairing(sounding(frame(17.3), analyse(notes))).main!;
  const exactHigh = { ...main.high, midi: main.low.midi + 12 * Math.log2(3) };
  const exact = pair(main.low, exactHigh);
  expect(exact.ratio).toBeCloseTo(3, 12);
  const exactTrace = trace(exact, exact.shorter.end),
    realTrace = trace(main, main.shorter.end);
  expect(Math.abs(exactTrace.points.at(-1)!)).toBeLessThan(1e-5);
  expect(Math.abs(realTrace.points.at(-1)!)).toBeGreaterThan(0.1);
  expect(main.ratio).not.toBe(3);
});
it('reads real scaled degrees, frequency, microtones and fragments through the shared pitch reader', async () => {
  const result = await queryEventsNode('n("0 2 4").scale("C:major").s("sine")', 0, 1);
  expect(result.error).toBeNull();
  const scaled = viewNotes({ from: 0, to: 1, events: { scale: result } });
  expect(analyse(scaled).map((t) => t.midi)).toEqual([48, 52, 55]);
  const real = notes.find((n) => n.value.note !== undefined)!;
  const tones = analyse([
    { ...real, start: 0, end: 1, hasOnset: false, value: { freq: 440, n: 0 } },
    { ...real, start: 0, end: 1, value: { note: 69.03 } },
  ]);
  expect(tones.map((t) => t.midi)).toEqual([69, 69.03]);
  expect(pairing(tones).main?.interval).toBe('unison +3.0¢');
  expect(sounding(frame(0.4), tones)).toHaveLength(2);
});
it('makes fewer-than-two-pitches explicit, supports unison, and follows mute changes', () => {
  const f = frame(17.3),
    tones = analyse(notes),
    current = sounding(f, tones);
  expect(pairing([]).main).toBeUndefined();
  expect(pairing(current.slice(0, 1)).main).toBeUndefined();
  expect(pairing([current[0], current[0]]).main?.interval).toBe('unison');
  f.instruments.forEach((i) => {
    i.muted = true;
  });
  expect(pairing(sounding(f, tones)).main).toBeUndefined();
  f.instruments.forEach((i) => {
    i.muted = false;
  });
  expect(sounding(f, tones)).toEqual(current);
  expect(intervalName(31).name).toBe('2 octaves + perfect fifth');
});
it('counts every dense pair for one and twenty instruments, with bounded representative occupancy', () => {
  const real = notes.find((n) => n.value.note !== undefined)!;
  for (const instruments of [1, 20]) {
    const dense = Array.from({ length: 500 }, (_, i) => ({
      ...real,
      instrument: String(i % instruments),
      start: 0,
      end: 1,
      value: { note: 36 + (i % 48) },
    }));
    const tones = analyse(dense),
      set = pairing(tones);
    expect(tones).toHaveLength(500);
    expect(set.count).toBe(124750);
    expect(1 + set.others.reduce((n, p) => n + p.count, 0)).toBe(set.count);
    expect(set.others.length).toBeLessThanOrEqual(6);
    expect(set.aggregated).toBe(true);
    for (const p of [set.main!, ...set.others.map((o) => o.pair)]) {
      const drawing = trace(p, 0.4);
      expect(drawing.points.length).toBeLessThanOrEqual(8194);
      expect([...drawing.points].every((n) => Number.isFinite(n) && Math.abs(n) <= 1)).toBe(true);
    }
  }
});
it('uses at least the card’s main amplitude at Stage A and a large readable Stage B figure', () => {
  expect(layout(1300, 760, 5).radius).toBeGreaterThanOrEqual(225 * (1300 / 960));
  expect(layout(1299, 674.5, 5).radius).toBeGreaterThanOrEqual(225 * (1299 / 960));
  for (const h of [470.5, 760]) {
    const g = layout(560, h, 5);
    expect(g.radius).toBeGreaterThanOrEqual(225 * (560 / 960));
    expect((g.radius * 2) / h).toBeGreaterThan(0.6);
    expect(g.cy - g.radius).toBeGreaterThanOrEqual(0);
    expect(g.captionY + 20).toBeLessThan(g.miniY > g.chartHeight ? g.miniY : h);
  }
});
