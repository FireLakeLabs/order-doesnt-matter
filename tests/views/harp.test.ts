import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import {
  analyse,
  displacement,
  layout,
  motion,
  partsAt,
  pitchLabel,
  sectionAt,
  shimmerWidth,
  stringGeometry,
  usesSection,
} from '../../src/views/harp/model';
import type { ViewFrame, ViewNote } from '../../src/views/types';
import { scoreFrame } from './score-fixture';
let notes: ViewNote[], ids: string[], sections: ViewFrame['sections'];
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  ids = state.rows.map((r) => r.id);
  sections = state.sections.map((s) => ({ name: s.name, from: s.start, to: s.start + s.cycles }));
  const results = await Promise.all(
    state.rows.map(async (row) => {
      const result = await queryEventsNode(generate(state.doc!, { only: row.id }), 0, 28);
      expect(result.error).toBeNull();
      return [row.id, result] as const;
    }),
  );
  notes = viewNotes({ from: 0, to: 28, events: Object.fromEntries(results) });
});
function frame(now: number): ViewFrame {
  const f = scoreFrame(ids.length);
  f.instruments.forEach((i, n) => {
    i.id = ids[n];
    i.name = 'renamed';
  });
  return { ...f, now, from: 0, to: 28, notes, sections };
}
const active = (now: number) =>
  analyse(notes)
    .strings.filter((s) => partsAt(s.voices, frame(now)).length)
    .flatMap((s) => s.pitches);
it('indexes every real song pitch once, low to high, independently of note order', () => {
  const score = analyse(notes);
  expect(score.pitchCount).toBe(19);
  expect(score.strings).toHaveLength(score.pitchCount);
  expect(score.grouped).toBe(false);
  expect(analyse([...notes].reverse()).strings.map((s) => s.pitches)).toEqual(
    score.strings.map((s) => s.pitches),
  );
  expect(active(17.3)).toEqual([44, 51, 60, 63]);
  expect(active(10.4)).toEqual([27, 39]);
});
it('lights pitches used anywhere in the actual section, not instrument names or current notes', () => {
  const score = analyse(notes),
    f = frame(17.3),
    section = sectionAt(f);
  expect(section.name).toBe('breakdown');
  expect(section).toEqual({ name: 'breakdown', from: 16, to: 20 });
  expect(usesSection(score.strings.find((s) => s.pitches.includes(44))!.voices, section)).toBe(
    true,
  );
  expect(usesSection(score.strings.find((s) => s.pitches.includes(27))!.voices, section)).toBe(
    false,
  );
  expect(sectionAt({ ...f, now: 45.3, from: 28, to: 56 })).toEqual({
    name: 'breakdown',
    from: 44,
    to: 48,
  });
  expect(sectionAt({ ...f, sections: [] })).toEqual({ name: 'whole song', from: 0, to: 28 });
});
it('shimmers on exact half-open scored spans and returns the same motion after arbitrary seeks', () => {
  const score = analyse(notes),
    slot = score.strings.find((s) => s.pitches.includes(63))!;
  const p = partsAt(slot.voices, frame(17.3))[0],
    note = p.voices[0].note;
  expect([note.start, note.end]).toEqual([17.25, 17.375]);
  expect(partsAt(slot.voices, frame(note.start))).toHaveLength(1);
  expect(partsAt(slot.voices, frame(note.end))).toHaveLength(0);
  const at = motion(p, 17.3);
  motion(p, -20);
  motion(p, 50);
  expect(motion(p, 17.3)).toEqual(at);
  const onset = motion(p, note.start);
  expect(displacement(0, onset)).toBe(0);
  expect(displacement(1, onset)).toBeCloseTo(0);
  expect(displacement(1 / 3, onset)).toBeCloseTo(onset.gain);
  expect(onset.pluck).toBe(1);
  expect(motion(p, note.end).pluck).toBe(0);
});
it('gain controls width and two parts on one string keep both braiding owners', () => {
  const n = notes.find((n) => n.value.note !== undefined)!;
  const voices = [
    { ...n, instrument: ids[0], start: 0, end: 1, hasOnset: true, value: { note: 60, gain: 0.25 } },
    {
      ...n,
      instrument: ids[1],
      start: 0,
      end: 1,
      hasOnset: true,
      value: { freq: 261.6255653005986, gain: 0.5 },
    },
  ];
  const score = analyse(voices),
    f = frame(0.1),
    g = layout(1300, 760, 1, 0);
  expect(score.strings).toHaveLength(1);
  const parts = partsAt(score.strings[0].voices, f);
  expect(parts.map((p) => p.instrument).sort()).toEqual([ids[0], ids[1]].sort());
  expect(parts.map((p) => p.phase)).toEqual([0, Math.PI]);
  const a = motion(parts[0], 0),
    b = motion(
      {
        ...parts[0],
        voices: parts[0].voices.map((v) => ({
          ...v,
          note: { ...v.note, value: { ...v.note.value, gain: 0.5 } },
        })),
      },
      0,
    );
  expect(shimmerWidth(b.gain, g)).toBeCloseTo(shimmerWidth(a.gain, g) * 2);
  expect(displacement(1 / 3, motion(parts[0], 0)) / motion(parts[0], 0).gain).toBeCloseTo(
    -displacement(1 / 3, motion(parts[1], 0)) / motion(parts[1], 0).gain,
  );
  f.instruments.find((i) => i.id === ids[0])!.muted = true;
  expect(partsAt(score.strings[0].voices, f).map((p) => p.instrument)).toEqual([ids[1]]);
});
it('retains every real unpitched instrument as a drumhead, including bare sample n', () => {
  const score = analyse(notes);
  const ade = notes.filter((n) => n.value.s === 'ade');
  expect(ade.length).toBeGreaterThan(0);
  expect(analyse(ade).pitchCount).toBe(0);
  expect(score.drums.some((d) => d.instrument === ade[0].instrument)).toBe(true);
  for (const n of notes.filter((n) => n.value.note === undefined && n.value.freq === undefined))
    expect(score.drums.some((d) => d.instrument === n.instrument)).toBe(true);
  const mixed = analyse([
    { ...ade[0], start: 0, end: 1, hasOnset: true },
    { ...ade[0], start: 1, end: 2, hasOnset: true, value: { note: 60 } },
  ]);
  expect(mixed.pitchCount).toBe(1);
  expect(mixed.drums).toHaveLength(1);
});
it('reads real scaled n, frequency and microtones while coalescing continuation fragments', async () => {
  const result = await queryEventsNode('n("0 2 4").scale("C:major").s("sine")', 0, 1);
  expect(result.error).toBeNull();
  expect(
    analyse(viewNotes({ from: 0, to: 1, events: { scaled: result } })).strings.map(
      (s) => s.pitches[0],
    ),
  ).toEqual([48, 52, 55]);
  const n = { ...notes[0], start: 0, end: 1, hasOnset: true, value: { note: 69 } };
  expect(
    analyse([n, { ...n, hasOnset: false, value: { note: 84 } }, { ...n, hasOnset: false }])
      .pitchCount,
  ).toBe(1);
  const carried = analyse([48, 52, 55].map((note) => ({ ...n, hasOnset: false, value: { note } })));
  expect(carried.pitchCount).toBe(3);
  expect(motion(partsAt(carried.strings[0].voices, frame(0.4))[0], 0.4).pluck).toBe(0);
  expect(
    analyse([
      { ...n, value: { freq: 440 } },
      { ...n, value: { note: 69.03 } },
    ]).pitchCount,
  ).toBe(2);
  expect(pitchLabel(69.03)).toBe('A4+3¢');
});
it('groups strictly above 40 pitches by octave without losing any pitch, voice or owner', () => {
  const n = notes.find((n) => n.value.note !== undefined)!;
  for (const count of [40, 41, 500])
    for (const parts of [1, 20]) {
      const dense = Array.from({ length: count }, (_, i) => ({
        ...n,
        instrument: String(i % parts),
        start: 0,
        end: 1,
        hasOnset: true,
        value: { note: 24 + i },
      }));
      const score = analyse(dense);
      expect(score.grouped).toBe(count > 40);
      expect(score.pitchCount).toBe(count);
      expect(score.strings.flatMap((s) => s.pitches)).toHaveLength(count);
      expect(score.strings.reduce((sum, s) => sum + s.voices.length, 0)).toBe(count);
      expect(
        score.strings.reduce(
          (sum, s) =>
            sum +
            partsAt(s.voices, { ...frame(0.4), instruments: scoreFrame(parts).instruments }).reduce(
              (n, p) => n + p.voices.length,
              0,
            ),
          0,
        ),
      ).toBe(count);
      if (count > 40)
        for (const s of score.strings)
          expect(new Set(s.pitches.map((p) => Math.floor(p / 12))).size).toBe(1);
    }
  const repeated = analyse(
    Array.from({ length: 500 }, () => ({ ...n, start: 0, end: 1, hasOnset: true })),
  );
  expect(repeated.strings.reduce((sum, s) => sum + s.voices.length, 0)).toBe(500);
});
it('fills Stage A height at card scale and keeps 40 strings distinct on Stage B', () => {
  const a = layout(1300, 760, 19, 9);
  expect(a.bottom - a.top + 30).toBeGreaterThanOrEqual((476 * 1300) / 960);
  for (const [w, h] of [
    [1300, 760],
    [560, 470.5],
    [560, 760],
    [1131, 469],
  ]) {
    const g = layout(w, h, 40, 9);
    expect(g.bottom - g.top + 30).toBeGreaterThan(h * 0.6);
    expect(g.spacing).toBeGreaterThan(10);
    for (let i = 0; i < 40; i++) {
      const s = stringGeometry(g, i, 40);
      expect(s.top).toBeGreaterThanOrEqual(94);
      expect(s.bottom).toBeGreaterThan(s.top);
      expect(shimmerWidth(10, g) * 3.6).toBeLessThan(g.spacing);
    }
    const heads = layout(w, h, 19, 20);
    expect(heads.drumTop + heads.rows * 34 + 14).toBeLessThanOrEqual(h);
  }
});

it('clears the base heads and canvas with angled labels, including the no-drum case', () => {
  for (const [w, h, count, drums] of [
    [560, 470.5, 19, 0],
    [560, 470.5, 19, 3],
    [560, 470.5, 19, 4],
    [1131, 469, 40, 4],
    [700, 500, 24, 3],
    [560, 470.5, 16, 3],
  ]) {
    const g = layout(w, h, count, drums);
    expect(g.angled).toBe(true);
    expect(g.strip).toBe(true);
    expect(g.labelWidth).toBeGreaterThan(18);
    for (let i = 0; i < count; i++) {
      const line = stringGeometry(g, i, count);
      const labelBottom = line.bottom + 26 + g.labelWidth * Math.sin(Math.PI / 3) + 2;
      expect(labelBottom).toBeLessThan(h);
      if (drums) expect(labelBottom).toBeLessThan(g.drumTop);
    }
  }
});
it('groups microtones in the octave of their displayed nearest note', () => {
  const n = notes.find((n) => n.value.note !== undefined)!;
  const score = analyse([
    ...Array.from({ length: 40 }, (_, i) => ({
      ...n,
      start: i,
      end: i + 1,
      hasOnset: true,
      value: { note: 24 + i },
    })),
    { ...n, start: 0, end: 1, hasOnset: true, value: { note: 71.6 } },
  ]);
  expect(score.grouped).toBe(true);
  expect(pitchLabel(71.6)).toBe('C5-40¢');
  expect(score.strings.find((s) => s.pitches.includes(71.6))?.label).toBe('oct 5');
});
