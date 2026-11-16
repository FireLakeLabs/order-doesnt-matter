import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importStrudel } from '../src/import';
import { instruments } from '../src/document';
import { initialState, loadPiece } from '../src/app/state';
import { sheetModel, type Row } from '../src/sheet/model';
import type { EventResult } from '../src/contract';
import {
  hitNote,
  hitRow,
  laneRows,
  noteRects,
  scoreRange,
  settingLaneId,
  rulerTicks,
} from '../src/studio/lanes/model';
import { customWords } from '../src/studio/tray/model';
import { scoreModel } from '../src/studio/lanes/score-model';
import { instrumentDetails, instrumentFacts } from '../src/studio/view-instruments';

const state = loadPiece(
  initialState(),
  '',
  importStrudel(readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8')),
);
const rowsAt = (from: number, to: number) =>
  sheetModel({
    doc: state.doc!,
    fromCycle: from,
    toCycle: to,
    playhead: from,
    sounds: [],
    events: {},
  }).rows;

test('real arrangement follows absolute sections and pages without assuming repetition', () => {
  expect(scoreRange(state.sections, 8.4)).toMatchObject({ from: 8, to: 16 });
  expect(scoreRange(state.sections, 44.5)).toMatchObject({ from: 44, to: 48 });
  expect(scoreRange([], 17)).toEqual({ from: 16, to: 20, name: 'Score' });
  expect(rowsAt(8, 16).filter((row) => !row.absent)).toHaveLength(6);
  expect(rowsAt(16, 20).filter((row) => !row.absent)).toHaveLength(3);
});
test('thirteen real rows fit 1080p at 44/14 minima; resting rows shrink before overflow', () => {
  const rows = rowsAt(8, 16);
  const lanes = laneRows(rows, 365, []);
  expect(lanes).toHaveLength(13);
  expect(lanes.filter((lane) => !lane.row.absent).every((lane) => lane.height >= 44)).toBe(true);
  expect(lanes.filter((lane) => lane.row.absent).every((lane) => lane.height >= 14)).toBe(true);
  expect(lanes.at(-1)!.y + lanes.at(-1)!.height).toBeLessThanOrEqual(365);
  const more = [
    ...rows,
    ...Array.from({ length: 5 }, (_, i) => ({ ...rows.find((r) => r.absent)!, id: `extra-${i}` })),
  ];
  const compact = laneRows(more, 365, []);
  expect(compact.filter((lane) => lane.row.absent).every((lane) => lane.height === 8)).toBe(true);
  expect(compact.at(-1)!.y + compact.at(-1)!.height).toBeLessThanOrEqual(365);
  const crowded = laneRows([...more, ...more], 365, []);
  expect(crowded.at(-1)!.y + crowded.at(-1)!.height).toBeGreaterThan(365);
});
test('note geometry uses real clipped spans, pitch, fragments and minimum mark width; no signal notes', () => {
  const lane = { row: { absent: false } as Row, y: 10, height: 60 };
  const events: EventResult = {
    cps: 1,
    error: null,
    opaqueValues: false,
    events: [
      { whole: [-0.5, 0.3], part: [0, 0.3], hasOnset: false, value: { note: 'c3' } },
      { whole: [0.65, 0.6501], part: [0.65, 0.6501], hasOnset: true, value: { note: 'c4' } },
      { whole: null, part: [0.2, 0.6], hasOnset: false, value: 0.5 },
    ],
  };
  const notes = noteRects(events, lane, 0, 1, 100);
  expect(notes).toHaveLength(2);
  expect(notes[0]).toMatchObject({ x: 0, width: 30 });
  expect(notes[1]).toMatchObject({ x: 65, width: 3 });
  expect(notes[1].y).toBeLessThan(notes[0].y);
  expect(hitNote(notes, 66, notes[1].y + 1)).toBe(notes[1]);
  expect(hitNote(notes, 32, 30)).toBeUndefined();
  expect(hitRow([lane], 10)).toBe(lane);
  expect(hitRow([lane], 70)).toBeUndefined();
});
test('the tray retains custom source and section-local settings from the sheet inventory', () => {
  const doc = importStrudel(readFileSync('corpus/programs/micro-register.strudel', 'utf8')).doc;
  expect(customWords(doc)).toEqual([
    expect.objectContaining({ name: 'ghosts', source: expect.stringContaining('register') }),
  ]);
  const pad = rowsAt(16, 20).find((r) => r.name === 'darkPad')!;
  const input = {
    doc: state.doc!,
    events: {
      [pad.id]: {
        cps: 1,
        error: null,
        opaqueValues: false,
        events: [
          {
            whole: [16, 17] as [number, number],
            part: [16, 17] as [number, number],
            hasOnset: true,
            value: { lpf: 1200 },
          },
        ],
      },
    },
    sounds: [],
    fromCycle: 16,
    toCycle: 20,
    playhead: 16,
  };
  const items = scoreModel(input).rows.find((row) => row.id === pad.id)!;
  const local = items.cells.find(
    (s) => s.name === 'lpf' && s.nodeId !== pad.cells.find((s) => s.name === 'lpf')?.nodeId,
  )!;
  expect(local.label).toBe('1200');
  expect(local.marks[0]).toMatchObject({ value: 1200, start: 16, end: 17 });
});
test('source-only corpus code stays retained for text editing', () => {
  const source = readFileSync('corpus/programs/micro-query-late-throws.strudel', 'utf8');
  const doc = importStrudel(source).doc;
  const row = instruments(doc)[0];
  expect(row.pattern.core).toMatchObject({ kind: 'opaque', code: source.trim() });
});

test('a value lane is identified by instrument and setting even when editor targets are shared', () => {
  const row = rowsAt(8, 16).find((row) => !row.absent)!;
  const cell = row.cells[0];
  const other = { ...cell, name: 'another setting' };
  const source = { ...row, cells: [cell, other] };
  const expanded = [settingLaneId(row.id, cell)];
  const lanes = laneRows([source], 100, expanded);
  expect(lanes).toHaveLength(2);
  expect(lanes[1].setting).toBe(expanded[0]);
});

test('ruler labels remain whole-cycle addresses in fractional and long sections', () => {
  expect(rulerTicks(8, 16, 1200)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
  expect(rulerTicks(0.5, 3.5, 1200)).toEqual([1, 2, 3]);
  const ticks = rulerTicks(0, 300, 1200);
  expect(ticks.length).toBeLessThanOrEqual(24);
  expect(ticks.every(Number.isInteger)).toBe(true);
});

test('views and tray use the same setting inventory, labels and ordered rewrites', () => {
  const doc = importStrudel(
    'const part = s("bd").gain(0.4).fast(2); arrange([4, part.rev()], [4, part.slow(2)])',
  ).doc;
  const model = scoreModel({ doc, events: {}, sounds: [], fromCycle: 0, toCycle: 4, playhead: 0 });
  const row = model.rows[0],
    details = instrumentDetails(doc).get(row.id)!;
  const facts = instrumentFacts(doc).get(row.id)!;
  expect(details.settings.map((setting) => setting.name)).toEqual(['s', 'gain']);
  expect(facts.settings).toContainEqual({
    name: 'gain',
    label: 'Level',
    kind: 'constant',
    value: 0.4,
  });
  expect(row.cells.filter((cell) => cell.name !== 'rhythm').map((cell) => cell.nodeId)).toEqual(
    details.settings.map((setting) => setting.nodeId),
  );
  expect(row.rewrites.map((rewrite) => rewrite.summary)).toEqual(
    details.rewrites
      .filter((rewrite) => !rewrite.sectionId || rewrite.sectionId === model.sections[0].nodeId)
      .map((rewrite) => rewrite.label),
  );
  expect(facts.rewrites).toEqual(details.rewrites.map((rewrite) => rewrite.label));
});
