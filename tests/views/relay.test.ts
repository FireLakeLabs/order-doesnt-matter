import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  indexRelay,
  relayFocus,
  capsules,
  rational,
  relayRange,
} from '../../src/views/relay/model';
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

it('finds the two real five-note bass contours in four-bar phrases, exactly +12 semitones apart', () => {
  const frame = corpus.get('real-dubstep-arranged')!;
  const score = indexRelay(frame);
  const sub = frame.instruments.find((i) => i.name === 'subBass')!;
  const wobble = frame.instruments.find((i) => i.name === 'wobbleBass')!;
  const bass = score.phrases.filter((p) => p.instrument === sub.id || p.instrument === wobble.id);
  expect(bass.map((p) => p.pitches.length)).toEqual(Array(8).fill(5));
  expect(bass.map((p) => p.from)).toEqual([8, 12, 20, 24, 8, 12, 20, 24]);
  expect(new Set(bass.map((p) => p.shape)).size).toBe(1);
  expect(score.returns).toHaveLength(28);
  expect(score.returns.every((r) => r.kind === 'exact' && r.distance === 0)).toBe(true);
  const a = bass.find((p) => p.instrument === sub.id && p.from === 8)!;
  const b = bass.find((p) => p.instrument === wobble.id && p.from === 8)!;
  expect(score.returns.find((r) => r.before === a.id && r.after === b.id)).toMatchObject({
    kind: 'exact',
    transpose: 12,
  });
  expect(a.pitches).toEqual([24, 24, 27, 29, 31]);
  expect(b.pitches).toEqual([36, 36, 39, 41, 43]);
  const focus = relayFocus(score, 10.4);
  expect(focus.current.has(a.id)).toBe(true);
  expect(focus.current.has(b.id)).toBe(true);
  expect(bass.every((p) => focus.related.has(p.id))).toBe(true);
  // Reordering source records or renaming/muting instruments cannot decide matches.
  const changed = indexRelay({
    ...frame,
    notes: frame.notes.slice().reverse(),
    instruments: frame.instruments.map((i) => ({ ...i, name: 'x', muted: true })).reverse(),
  });
  expect(changed.returns).toEqual(score.returns);
});
function phraseFrame() {
  const f = scoreFrame(2);
  f.to = 8;
  f.now = 1.4;
  f.sections = [{ name: 'one', from: 0, to: 8 }];
  f.notes = [0, 4].flatMap((start, part) =>
    [0, 0, 3, 5, 7].map((p, i) => ({
      instrument: String(part),
      start: start + i / 2,
      end: start + (i + 1) / 2,
      hasOnset: true,
      value: { note: 48 + part * 12 + p },
    })),
  );
  return f;
}
it('never upgrades a near match, altered rhythm, duration or opaque timing to exact', () => {
  const f = phraseFrame();
  expect(indexRelay(f).returns[0]).toMatchObject({ kind: 'exact', transpose: 12 });
  f.notes[8].value.note = 66;
  expect(indexRelay(f).returns[0]).toMatchObject({ kind: 'near', distance: 0.2, transpose: 12 });
  f.notes[8].value.note = 69;
  expect(indexRelay(f).returns).toEqual([]);
  const rhythm = phraseFrame();
  rhythm.notes[8].start += 1 / 64;
  expect(indexRelay(rhythm).returns).toEqual([]);
  const duration = phraseFrame();
  duration.notes[8].end -= 1 / 64;
  expect(indexRelay(duration).returns).toEqual([]);
  const opaque = phraseFrame();
  opaque.notes[8].start += Math.SQRT2 / 100;
  expect(indexRelay(opaque).returns).toEqual([]);
  expect(rational(Math.SQRT2)).toBeNull();
  expect(rational(1 / 3)).toEqual([1, 3]);
});
it('keeps translated phrases and rational thirds equal without decimal rounding or guessed windows', () => {
  const f = phraseFrame();
  const translated = {
    ...f,
    notes: f.notes.map((n, i) => (i < 5 ? n : { ...n, start: n.start + 0.25, end: n.end + 0.25 })),
  };
  expect(indexRelay(translated).returns[0]?.kind).toBe('exact');
  f.notes = f.notes.map((n, i) => ({
    ...n,
    start: (i < 5 ? 0 : 4) + (i % 5) / 3,
    end: (i < 5 ? 0 : 4) + ((i % 5) + 1) / 3,
  }));
  expect(indexRelay(f).returns[0]?.kind).toBe('exact');
  expect(indexRelay({ ...f, from: 0.1 }).returns).toEqual([]);
  expect(indexRelay({ ...f, to: 7.9 }).returns).toEqual([]);
  expect(indexRelay({ ...f, now: 10.4 }).returns).toEqual([]);
  expect(relayRange({ ...f, now: 10.4 })).toEqual([8, 16]);
});
it('counts chords, dense and unpitched notes, unknown continuations and long crossings', () => {
  const f = phraseFrame();
  const ambiguous = { ...f, notes: f.notes.map((n) => ({ ...n, value: { n: n.value.note } })) };
  expect(indexRelay(ambiguous).returns).toEqual([]);
  const frequency = {
    ...f,
    notes: f.notes.map((n) => ({
      ...n,
      value: { n: 0, freq: 440 * 2 ** ((Number(n.value.note) - 69) / 12) },
    })),
  };
  expect(indexRelay(frequency).phrases.every((p) => p.pitches.length === 5)).toBe(true);
  const chord = { ...f.notes[0], value: { note: 51 } };
  expect(indexRelay({ ...f, notes: [...f.notes, chord] }).returns).toEqual([]);
  const missing = { ...f.notes[0], hasOnset: false, start: 3, end: 3.5 };
  expect(indexRelay({ ...f, notes: [...f.notes, missing] }).returns).toEqual([]);
  const fragments = indexRelay({
    ...f,
    notes: [...f.notes, ...f.notes.map((n) => ({ ...n, hasOnset: false }))],
  });
  expect(fragments.returns[0]?.kind).toBe('exact');
  const dense = scoreFrame(20);
  dense.to = 16;
  dense.notes = Array.from({ length: 500 }, (_, i) => ({
    instrument: String(i % 20),
    start: i / 500,
    end: (i + 1) / 500,
    hasOnset: true,
    value: { s: 'bd' },
  }));
  const score = indexRelay(dense);
  expect(score.returns).toEqual([]);
  const caps = dense.instruments.flatMap((i) =>
    capsules(
      score.phrases.filter((p) => p.instrument === i.id),
      score.from,
      score.to,
      380,
    ),
  );
  expect(caps.reduce((n, c) => n + c.count, 0)).toBe(500);
  const crossing = scoreFrame();
  crossing.to = 16;
  crossing.notes = [{ instrument: '0', start: 1, end: 12, hasOnset: true, value: { note: 48 } }];
  const long = indexRelay(crossing);
  expect(capsules(long.phrases, 0, 16, 400).reduce((n, c) => n + c.count, 0)).toBe(1);
});
it('keeps real score records accounted for and does not invent returns in a contrasting real piece', () => {
  for (const f of corpus.values()) {
    const score = indexRelay(f);
    const notes = new Set(score.phrases.flatMap((p) => p.notes));
    expect(notes.size).toBe(f.notes.length);
  }
  const techno = indexRelay(corpus.get('real-techno')!);
  expect(techno.returns).toEqual([]); // 32 pitched notes per block are too dense to call phrases.
});
