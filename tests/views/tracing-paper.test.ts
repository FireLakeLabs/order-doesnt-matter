import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importStrudel } from '../../src/import';
import { instruments, walk, type Doc, type Pattern } from '../../src/document';
import { parseSteps } from '../../src/import/mini';
import { createHistoryLookup } from '../../src/studio/history-lookup';
import { history, push } from '../../src/editor/history';
import { queryEventsNode } from '../node-query';
import type { ViewHistoryScore, ViewHistoryVersion } from '../../src/views/types';
import {
  barCounts,
  compareScores,
  countBins,
  defaultPair,
  pencilOpacity,
  indexSheet,
  markGeometry,
} from '../../src/views/tracing-paper/model';

function score(
  times: number[],
  values: Record<string, unknown>[] = times.map(() => ({ s: 'hh' })),
  id = 'part',
): ViewHistoryScore {
  return {
    from: 0,
    to: 16,
    instruments: [
      {
        id,
        patternId: 'pattern',
        path: ['body', 0, 'pattern'],
        uses: [],
        result: {
          cps: 0.5,
          error: null,
          opaqueValues: false,
          events: times.map((start, i) => ({
            whole: [start, start + 0.125],
            hasOnset: true,
            part: [start, start + 0.125],
            value: values[i],
          })),
        },
      },
    ],
  };
}
test('mutual unique nearest onsets move, but ties, competing notes and different pitches do not', () => {
  expect(
    compareScores(score([0, 0.25, 0.625, 0.875]), score([0, 0.6875, 0.875, 0.9375])).moved,
  ).toHaveLength(1);
  const tied = compareScores(score([0.25, 0.375]), score([0.3125]));
  expect(tied.moved).toHaveLength(0);
  expect(tied.removed).toHaveLength(2);
  expect(tied.added).toHaveLength(1);
  const far = compareScores(score([0]), score([0.2]));
  expect(far.moved).toHaveLength(0);
  const pitchChange = compareScores(
    score([0], [{ s: 'hh', note: 60 }]),
    score([0.0625], [{ s: 'hh', note: 61 }]),
  );
  expect(pitchChange.moved).toHaveLength(0);
  expect(pitchChange.added).toHaveLength(1);
  const equivalent = compareScores(
    score([0], [{ s: 'hh', note: 'c4' }]),
    score([0.0625], [{ s: 'hh', note: 60 }]),
  );
  expect(equivalent.moved).toHaveLength(1);
});
test('uses document identity before paths, preserves duplicate counts and never uses event order', () => {
  const a = score([0, 0.125, 0.25]);
  const b = structuredClone(a);
  b.instruments[0].result.events.reverse();
  expect(compareScores(a, b).identical).toBe(true);
  b.instruments[0].path = ['body', 12];
  expect(compareScores(a, b).identical).toBe(true);
  b.instruments[0].id = 'new';
  expect(compareScores(a, b).identical).toBe(true);
  b.instruments[0].patternId = 'other';
  expect(compareScores(a, b).added).toHaveLength(3);
  const duplicates = compareScores(score([0, 0, 0]), score([0, 0]));
  expect(duplicates.removed).toHaveLength(1);
  const changed = compareScores(score([0], [{ gain: 0.75 }]), score([0], [{ gain: 0.66 }]));
  expect(changed.settings).toEqual([
    { instrument: 'part', name: 'gain', before: '0.75', after: '0.66' },
  ]);
});
test('does not call broken or opaque scores identical, and sees held spans without inventing onsets', () => {
  const a = score([0]),
    b = structuredClone(a);
  b.instruments[0].result.error = { phase: 'query', message: 'broken' };
  expect(compareScores(a, b).errors).toEqual(['Ink: broken']);
  expect(compareScores(a, b).identical).toBe(false);
  b.instruments[0].result.error = null;
  b.instruments[0].result.opaqueValues = true;
  expect(compareScores(a, b).identical).toBe(false);
  b.instruments[0].result.opaqueValues = false;
  b.instruments[0].result.events[0].whole = null;
  const diff = compareScores(a, b);
  expect(diff.fresh[0].hasOnset).toBe(false);
  expect(diff.identical).toBe(false);
  expect(compareScores(score([0.1]), score([0.10000000000000002])).identical).toBe(true);
  const resized = structuredClone(a);
  resized.instruments[0].result.events[0].whole = [0, 0.25];
  expect(compareScores(a, resized).resized).toHaveLength(1);
  expect(compareScores(a, resized).identical).toBe(false);
});
test('defaults around present, not redo future; pencil age fades; dense bins account for all 500 marks', () => {
  const versions = ['past', 'present', 'future'].map((position, ordinal) => ({
    position,
    id: String(ordinal),
    ordinal,
  })) as ViewHistoryVersion[];
  expect(defaultPair(versions)).toEqual(['0', '1']);
  expect(defaultPair(versions.slice(1))).toBeUndefined();
  expect(pencilOpacity(2)).toBeLessThan(pencilOpacity(1));
  expect(pencilOpacity(500)).toBeGreaterThan(0);
  const notes = Array.from({ length: 500 }, (_, i) => i / 500);
  const bins = countBins(notes, (x) => x * 300, 26);
  expect(bins.reduce((s, b) => s + b.items.length, 0)).toBe(500);
  expect(bins.length).toBeLessThan(13);
  const diff = compareScores(score([]), score(notes));
  expect(diff.added).toHaveLength(500);
  expect(barCounts(diff, 0).added).toBe(500);
});
test('does not mistake a removed snare and added clap for a moved drum note', () => {
  for (const onset of [0.5, 0.5625]) {
    const diff = compareScores(
      score([0, 0.5], [{ s: 'bd' }, { s: 'sd' }]),
      score([0, onset], [{ s: 'bd' }, { s: 'cp' }]),
    );
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(1);
    expect(diff.moved).toHaveLength(0);
    expect(diff.settings).toHaveLength(0);
  }
});
test('retains an explicitly pitched note when its timbre setting changes', () => {
  const diff = compareScores(
    score([0.5], [{ note: 60, s: 'sawtooth' }]),
    score([0.5], [{ note: 60, s: 'sine' }]),
  );
  expect(diff.added).toHaveLength(0);
  expect(diff.removed).toHaveLength(0);
  expect(diff.settings.map((s) => s.name)).toEqual(['s']);
  const samples = compareScores(
    score([0.5], [{ n: 0, s: 'sd' }]),
    score([0.5625], [{ n: 0, s: 'cp' }]),
  );
  expect(samples.moved).toHaveLength(0);
  expect(samples.added).toHaveLength(1);
  expect(samples.removed).toHaveLength(1);
});
test('uses the ink part identity for matched pencil/ink notes and cached bar summaries', () => {
  const before = score([0], [{ s: 'hh', gain: 0.75 }], 'old'),
    after = score([0], [{ s: 'hh', gain: 0.66 }], 'new');
  const diff = compareScores(before, after);
  expect(diff.old[0].instrument).toBe('new');
  expect(diff.fresh[0].instrument).toBe('new');
  expect(diff.settings[0].instrument).toBe('new');
  const sheet = indexSheet(diff, 0, 16);
  expect(sheet.bars.get(0)?.counts).toEqual(barCounts(diff, 0));
  expect(sheet.bars.get(0)?.settings).toEqual(diff.settings);
  expect(sheet.bars.get(1)?.settings).toEqual([]);
});
test('caption plates clear ink rings in both adjacent rows at all supported row heights', () => {
  for (const height of [30, 31.3, 40, 80]) {
    const box = markGeometry(height);
    expect(-height + box.ringRadius + 0.75).toBeLessThan(box.captionTop);
    expect(box.captionTop + box.captionHeight).toBeLessThan(-box.ringRadius - 0.75);
    expect(box.captionBaseline).toBeGreaterThan(box.captionTop);
  }
});
test('indexes all 8,000 notes when one control changes on 500 notes per cycle', () => {
  const onsets = Array.from({ length: 8000 }, (_, i) => i / 500);
  const before = score(
    onsets,
    onsets.map(() => ({ s: 'hh', gain: 0.75 })),
  );
  const after = score(
    onsets,
    onsets.map(() => ({ s: 'hh', gain: 0.66 })),
  );
  const diff = compareScores(before, after);
  expect(diff.matched).toHaveLength(8000);
  expect(diff.added).toHaveLength(0);
  expect(diff.removed).toHaveLength(0);
  expect(diff.moved).toHaveLength(0);
  expect(diff.settings).toEqual([
    { instrument: 'part', name: 'gain', before: '0.75', after: '0.66' },
  ]);
});
function edited(doc: Doc, notation: string, lower = false) {
  const next = structuredClone(doc);
  if (lower)
    for (const row of instruments(next))
      if (JSON.stringify(row.pattern.core).includes('"notation":"hh*8"'))
        for (const layer of row.pattern.layers)
          if (layer.kind === 'settings')
            for (const setting of layer.settings)
              if (setting.name === 'gain')
                for (const l of setting.value.layers)
                  if (l.kind === 'rewrite' && l.name === 'range')
                    l.args = [
                      { kind: 'literal', value: 0.25 },
                      { kind: 'literal', value: 0.55 },
                    ];
  walk(next, (node) => {
    if ('core' in node) {
      const p = node as Pattern;
      if (p.core.kind === 'sequence' && p.core.notation === 'hh*8')
        p.core = { kind: 'sequence', notation, steps: parseSteps(notation) };
    }
  });
  return next;
}
test('real dubstep invented edit at bar 11: one addition, removal, move and sampled gain setting', async () => {
  const doc = importStrudel(
    readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
  ).doc;
  const next = edited(doc, '[hh hh ~ hh hh [~ hh] hh [hh hh]]', true);
  const cache = createHistoryLookup({ query: queryEventsNode, cancel() {} });
  const h = push(history(doc), next, 'document');
  const lookup = cache.forFrame(h, { from: 0, to: 28 });
  const snapshots = await Promise.all(lookup.versions.map((v) => lookup.score(v.id)));
  if (snapshots[0].status !== 'available' || snapshots[1].status !== 'available')
    throw Error('No scores');
  const diff = compareScores(snapshots[0].score, snapshots[1].score);
  expect(diff.errors).toEqual([]);
  expect(barCounts(diff, 10)).toEqual({ added: 1, removed: 1, moved: 1, settings: 1 });

  expect(diff.settings).toHaveLength(1);

  expect(diff.settings[0].name).toBe('gain');
  expect(Number(diff.settings[0].after.split('–')[0])).toBeLessThan(
    Number(diff.settings[0].before.split('–')[0]) - 0.09,
  );
  expect(diff.moved.find((p) => p.old.start === 10.625)?.fresh.start).toBe(10.6875);
  console.log(
    'TRACING PAPER REAL DUBSTEP',
    JSON.stringify({
      bar11: barCounts(diff, 10),
      song: {
        added: diff.added.length,
        removed: diff.removed.length,
        moved: diff.moved.length,
        settings: diff.settings,
      },
      spans: diff.resized.length,
    }),
  );
  cache.dispose();
});
test('a different real piece compares identically even when instrument order changes', async () => {
  const doc = importStrudel(readFileSync('corpus/programs/real-techno.strudel', 'utf8')).doc;
  const cache = createHistoryLookup({ query: queryEventsNode, cancel() {} });
  const lookup = cache.forFrame(history(doc), { from: 0, to: 16 });
  const answer = await lookup.score(lookup.versions[0].id);
  if (answer.status !== 'available') throw Error(answer.reason);
  expect(
    compareScores(answer.score, {
      ...answer.score,
      instruments: answer.score.instruments.slice().reverse(),
    }).identical,
  ).toBe(true);
  cache.dispose();
});

test('an unqueried future range cannot be inferred by shifting an old Strudel score', async () => {
  const a = await queryEventsNode('s("hh*3").gain(perlin)', 0, 1);
  const b = await queryEventsNode('s("hh*3").gain(perlin)', 16, 17);
  expect(a.error).toBeNull();
  expect(b.error).toBeNull();
  expect(a.events.map((e) => (e.value as Record<string, unknown>).gain)).not.toEqual(
    b.events.map((e) => (e.value as Record<string, unknown>).gain),
  );
});
