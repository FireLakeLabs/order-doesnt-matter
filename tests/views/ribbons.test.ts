import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, neededRange, viewNotes } from '../../src/studio/frame';
import type { ViewFrame, ViewNote } from '../../src/views/types';
import {
  cameraPose,
  indexRibbons,
  noteHeight,
  noteTurn,
  noteWidth,
  pastReach,
  pitchHeight,
  ribbonAt,
  ribbonGeometry,
  ribbonParts,
  scoredPitch,
} from '../../src/views/ribbons/model';
import { pitch } from '../../src/views/shared/pitch';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import { themes, instrumentColour } from '../../src/studio/themes';
import { labelColour } from '../../src/views/ribbons/labels';

let frame: ViewFrame;
let state: ReturnType<typeof loadPiece>;
let programs: Map<string, string>;
beforeAll(async () => {
  const source = readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8');
  state = loadPiece(initialState(), source, importStrudel(source));
  programs = new Map(state.rows.map((row) => [row.id, generate(state.doc!, { only: row.id })]));
  const entries = await Promise.all(
    state.rows.map(
      async (row) =>
        [row.id, await queryEventsNode(generate(state.doc!, { only: row.id }), 0, 28)] as const,
    ),
  );
  for (const [, result] of entries) expect(result.error).toBeNull();
  const score = { from: 0, to: 28, events: Object.fromEntries(entries) };
  frame = buildFrame({
    ...scoreFrame(),
    state,
    score,
    notes: viewNotes(score),
    lookAhead: 1,
  });
});
const only = (note: ViewNote): ViewFrame => ({
  ...frame,
  notes: [note],
  instruments: [{ ...frame.instruments.find((i) => i.id === note.instrument)!, inSection: true }],
});
const partAt = (note: ViewNote) => ribbonParts(only(note))[0];

it('keeps every allowed Window within the host history at four-cycle block edges', () => {
  for (const now of [8, 8.25, 11.99, 12])
    for (const window of [1, 2, 4, 8]) {
      const range = neededRange('window', now, window, state.sections);
      expect(now - pastReach * window).toBeGreaterThanOrEqual(range.from);
    }
});
it('opens exactly for the scored span and makes gain set the note width', () => {
  const note = frame.notes.find((n) => n.hasOnset && n.start === 10.375)!;
  const part = partAt(note);
  expect(ribbonAt(part, note.start - 0.0001).count).toBe(0);
  expect(ribbonAt(part, note.start).count).toBe(1);
  expect(ribbonAt(part, note.end - 0.0001).count).toBe(1);
  expect(ribbonAt(part, note.end).count).toBe(0);
  expect(noteWidth(part, { ...note, value: { ...note.value, gain: 1 } })).toBe(
    2 * noteWidth(part, { ...note, value: { ...note.value, gain: 0.5 } }),
  );
});
it('keeps a continuous thread through real rests and a completely resting instrument', () => {
  const note = frame.notes.find((n) => n.hasOnset && n.start === 10.5)!;
  const input = only(note),
    part = partAt(note);
  expect(ribbonAt(part, 10.4).count).toBe(0);
  expect(Number.isFinite(ribbonAt(part, 10.4).height)).toBe(true);
  const geometry = ribbonGeometry(input);
  const threadTimes = [];
  for (let i = 0; i < geometry.positions.length / 3; i++)
    if (geometry.marks[i * 3] === 0) threadTimes.push(geometry.positions[i * 3] + input.from);
  expect(Math.min(...threadTimes)).toBe(input.from);
  expect(Math.max(...threadTimes)).toBe(input.to);
  const empty = ribbonGeometry({ ...input, notes: [] });
  expect(empty.threads).toBe(1);
  expect(empty.spans).toBe(0);
  expect(empty.indices.length).toBeGreaterThan(0);
});
it('holds each sampled turn throughout a note and changes it at the next onset without reading instrument names', () => {
  const instrument = frame.instruments.find((i) => i.name === 'wobbleBass')!;
  const note = frame.notes.find(
    (n) => n.instrument === instrument.id && n.hasOnset && n.start === 10,
  )!;
  const part = partAt(note);
  const first = ribbonAt(part, 10.2).turn;
  expect(Math.abs(first)).toBeGreaterThan(0.01);
  expect(ribbonAt(part, 10.8).turn).toBe(first);
  const next = { ...note, start: 11, end: 12, value: { ...note.value, cutoff: 50 } };
  const changed = { ...part, notes: [note, next] };
  expect(ribbonAt(changed, 11 - 0.0001).turn).toBe(first);
  expect(ribbonAt(changed, 11).turn).toBe(noteTurn(next, instrument));
  expect(ribbonAt(changed, 11).turn).not.toBe(first);
  expect(noteTurn(note, { ...instrument, name: 'no role in this name' })).toBe(first);
});
it('sets actual note height from absolute pitch and stacks every unpitched part above pitched notes', () => {
  const parts = ribbonParts(frame);
  const lows = parts.filter((p) => !p.unpitched);
  const drums = parts.filter((p) => p.unpitched);
  expect(drums).toHaveLength(4);
  expect(lows).toHaveLength(2);
  expect(new Set(drums.map((p) => p.baseline)).size).toBe(4);
  for (const part of lows)
    for (const note of part.notes) {
      expect(noteHeight(part, note)).toBe(pitchHeight(pitch(note.value)!));
      expect(noteHeight(part, note)).toBeLessThan(Math.min(...drums.map((p) => p.baseline)));
    }
  expect(pitchHeight(39)).toBeGreaterThan(pitchHeight(27));
  const note = lows[0].notes[0];
  expect(noteHeight(lows[0], note)).toBe(noteHeight({ ...lows[0], notes: [note] }, note));
});
it('shows section members plus notes reaching in from an adjacent section, without naming roles', () => {
  expect(ribbonParts(frame)).toHaveLength(6);
  const boundary = { ...frame, now: 8, instruments: frame.instruments };
  const parts = ribbonParts(boundary);
  expect(parts.length).toBeGreaterThan(6);
  expect(
    parts.some((p) => !p.instrument.inSection && p.notes.some((n) => n.start < 8 && n.end > 7.5)),
  ).toBe(true);
});
it('keeps real colon-selected samples unpitched while retaining an authored n control', async () => {
  const parts = ribbonParts({ ...frame, sections: [] });
  for (const name of ['vocalAtmos', 'preDropVocal']) {
    const part = parts.find((p) => p.instrument.name === name)!;
    const note = part.notes.find((n) => typeof n.value.n === 'number')!;
    expect(note).toBeDefined();
    expect(scoredPitch(note, part.instrument)).toBeUndefined();
    expect(part.unpitched).toBe(true);
    expect(noteHeight(part, note)).toBe(part.baseline);
  }
  const result = await queryEventsNode('n("36 39").s("sawtooth")', 0, 1);
  expect(result.error).toBeNull();
  const input = {
    ...scoreFrame(),
    now: 0.1,
    from: 0,
    to: 1,
    sections: [],
    notes: viewNotes({ from: 0, to: 1, events: { '0': result } }),
  };
  input.instruments[0].settings = [{ name: 'n', label: 'Notes', kind: 'values' }];
  const part = ribbonParts(input)[0];
  expect(part.unpitched).toBe(false);
  expect(part.notes.map((n) => scoredPitch(n, part.instrument))).toEqual([36, 39]);
});
it('fans all twenty in depth, retains one full ribbon with one instrument, and keeps depth stable as section membership changes', () => {
  const input = {
    ...frame,
    sections: [],
    instruments: Array.from({ length: 20 }, (_, index) => ({
      ...frame.instruments[index % 13],
      id: String(index),
      index,
    })),
  };
  input.notes = input.instruments.flatMap((instrument, i) =>
    frame.notes
      .filter((n) => n.instrument === frame.instruments[i % 13].id)
      .map((n) => ({ ...n, instrument: instrument.id })),
  );
  const parts = ribbonParts(input);
  expect(parts).toHaveLength(20);
  expect(new Set(parts.map((p) => p.depth)).size).toBe(20);
  expect(parts[0].depth).toBeLessThan(parts[19].depth);
  expect(parts.every((p) => p.notes.length > 0)).toBe(true);
  expect(ribbonGeometry(input, parts).spans).toBe(
    parts.reduce((sum, p) => sum + p.notes.length, 0),
  );
  const single = ribbonParts({ ...input, instruments: input.instruments.slice(0, 1) });
  expect(single).toHaveLength(1);
  expect(single[0].depth).toBe(0);
  const changed = ribbonParts({
    ...input,
    sections: [{ name: 'test', from: 0, to: 28 }],
    instruments: input.instruments.map((i, index) => ({ ...i, inSection: index === 10 })),
  });
  for (const part of changed)
    expect(part.depth).toBe(parts.find((p) => p.instrument.id === part.instrument.id)!.depth);
});
it('keeps unpitched slots steady across real host windows, section changes and empty pitched lanes', async () => {
  const slots = new Map<string, number>();
  for (const now of [7.9, 10.4, 15.9, 16]) {
    const range = neededRange('window', now, 1, state.sections);
    const entries = await Promise.all(
      state.rows.map(
        async (row) =>
          [row.id, await queryEventsNode(programs.get(row.id)!, range.from, range.to)] as const,
      ),
    );
    for (const [, result] of entries) expect(result.error).toBeNull();
    const score = { ...range, events: Object.fromEntries(entries) };
    const current = buildFrame({ ...frame, state, score, notes: viewNotes(score), now });
    for (const part of ribbonParts(current))
      if (part.unpitched) {
        if (slots.has(part.instrument.id))
          expect(part.baseline).toBe(slots.get(part.instrument.id));
        else slots.set(part.instrument.id, part.baseline);
      }
  }
  expect(slots.size).toBeGreaterThanOrEqual(6);
  const all = { ...frame, sections: [] };
  const original = ribbonParts(all);
  const silentPitch = frame.instruments.find((i) => i.name === 'darkPad')!;
  const changed = ribbonParts({
    ...all,
    notes: frame.notes.filter((n) => n.instrument !== silentPitch.id),
  });
  expect(changed.find((p) => p.instrument.id === silentPitch.id)!.unpitched).toBe(false);
  for (const part of original.filter((p) => p.unpitched))
    expect(changed.find((p) => p.instrument.id === part.instrument.id)!.baseline).toBe(
      part.baseline,
    );
});
it('coalesces repeated real eight-cycle carry-ins, while retaining every genuine onset', async () => {
  const states: ReturnType<typeof ribbonAt>[] = [];
  for (const from of [0, 4]) {
    const result = await queryEventsNode('note("c3").slow(8)', from, 13);
    expect(result.error).toBeNull();
    const notes = viewNotes({ from, to: 13, events: { '0': result } });
    const input = { ...scoreFrame(), now: 6, from, to: 13, notes };
    const parts = ribbonParts(input, indexRibbons(notes));
    expect(parts[0].notes.filter((n) => n.start === 0)).toHaveLength(1);
    expect(ribbonGeometry(input, parts).spans).toBe(2);
    states.push(ribbonAt(parts[0], 6));
  }
  expect(states[1]).toEqual(states[0]);
  const note = frame.notes.find((n) => n.hasOnset && n.start === 10 && n.end === 11)!;
  const input = { ...only(note), notes: [note, note] };
  expect(ribbonGeometry(input).spans).toBe(2);
});
it('includes all 500 real note spans and finite thread/strip geometry without a density cutoff', async () => {
  const result = await queryEventsNode('s("hh*500").gain(0.4)', 0, 1);
  expect(result.error).toBeNull();
  const input = {
    ...scoreFrame(),
    now: 0.4,
    from: 0,
    to: 1,
    lookAhead: 1,
    notes: viewNotes({ from: 0, to: 1, events: { '0': result } }),
  };
  const geometry = ribbonGeometry(input);
  expect(geometry.spans).toBe(500);
  expect(geometry.threads).toBe(1);
  expect(geometry.positions.every(Number.isFinite)).toBe(true);
  expect(geometry.edges.every(Number.isFinite)).toBe(true);
  expect(geometry.indices.every((i) => i >= 0 && i < geometry.positions.length / 3)).toBe(true);
});
it('reproduces camera, sampled turns and geometry after arbitrary times and query-order visits', () => {
  const pose = cameraPose(frame.now),
    data = indexRibbons(frame.notes);
  const original = ribbonGeometry(frame, ribbonParts(frame, data));
  for (const now of [0, 19.2, 7.99, 8, 500]) {
    cameraPose(now);
    ribbonGeometry({ ...frame, now }, ribbonParts({ ...frame, now }, data));
  }
  expect(cameraPose(frame.now)).toEqual(pose);
  expect(ribbonGeometry(frame, ribbonParts(frame, data))).toEqual(original);
  expect(cameraPose(frame.now + 1)).not.toEqual(pose);
});

// Independent WCAG sRGB measurement, including rounded palette-wrap tints.
function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const channels = hex
      .slice(1)
      .match(/../g)!
      .map((value) => {
        const v = Number.parseInt(value, 16) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
    return channels.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + 0.05) / (values[0] + 0.05);
}
it.each(Object.values(themes))(
  '$name: every instrument label meets 4.5:1 on its opaque ground plate',
  (theme) => {
    // Covers every base colour, twenty instruments, repeated/tinted palette
    // wraps and later tints.
    for (let index = 0; index <= 100; index++) {
      const colour = instrumentColour(theme.name, index);
      const ink = labelColour(colour, theme);
      expect(
        contrastRatio(ink, theme.ground),
        `${theme.name} instrument ${index}: ${colour}`,
      ).toBeGreaterThanOrEqual(4.5);
      if (contrastRatio(colour, theme.ground) >= 4.5) expect(ink).toBe(colour);
      else expect(ink).toBe(theme.text);
    }
  },
);
it('makes the sweep’s Riso subBass label readable', () => {
  const colour = instrumentColour('riso', 10);
  expect(colour).toBe('#FFD033');
  expect(contrastRatio(colour, themes.riso.ground)).toBeLessThan(1.5);
  expect(
    contrastRatio(labelColour(colour, themes.riso), themes.riso.ground),
  ).toBeGreaterThanOrEqual(4.5);
});
