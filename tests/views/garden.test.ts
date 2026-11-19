import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  clusterTags,
  gardenLayout,
  gardenMoment,
  gardenRange,
  indexGarden,
  leafClusters,
  leafRadius,
  leafStyle,
} from '../../src/views/garden/model';
import { scoredNotes } from '../../src/views/shared/scored-notes';
import type { ViewFrame, ViewNote } from '../../src/views/types';

const corpus = new Map<string, ViewFrame>();
beforeAll(async () => {
  for (const file of ['real-dubstep-arranged', 'real-techno', 'micro-dense-64']) {
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
it('counts every real record and cycles section seasons, independently of instrument names', () => {
  const f = corpus.get('real-dubstep-arranged')!,
    g = indexGarden(f);
  const clusters = leafClusters(g, gardenLayout(g, 1300, 760));
  expect(g.plants.length).toBe(13);
  expect(g.sections.map((s) => s.season)).toEqual([0, 1, 2, 3, 0]);
  const result = gardenMoment(g, clusters, 10.4);
  expect(result.season).toBe('Autumn');
  expect(result.total).toBe(339);
  expect(result.grown).toBe(114);
  expect(g.continuations).toBe(54);
  expect(result.grown).toBe(scoredNotes(f.notes).filter((n) => n.start <= 10.4).length);
  expect(result.total).toBe(scoredNotes(f.notes).length);
  expect(g.plants.flatMap((p) => p.leaves).length).toBe(scoredNotes(f.notes).length);
  expect(
    indexGarden({
      ...f,
      notes: f.notes.slice().reverse(),
      instruments: f.instruments.map((p) => ({ ...p, name: 'changed' })).reverse(),
    }),
  ).toEqual(g);
  console.log('Garden real corpus mapping', result);
});
it('repeats identical sprigs, maps real gain/send/settings, and fixes pitch height while siblings end', () => {
  const f = scoreFrame();
  const a: ViewNote = {
    instrument: '0',
    start: 0.25,
    end: 1.8,
    hasOnset: true,
    value: { note: 'c3', gain: 0.3, lpf: 200, room: 0.7 },
  };
  const b = { ...a, start: 1.25, end: 2.8 };
  expect(leafStyle(a)).toEqual(leafStyle(b));
  expect(leafStyle({ ...a, value: { room: 0.7, lpf: 200, gain: 0.3, note: 'c3' } })).toEqual(
    leafStyle(a),
  );
  expect(leafStyle({ ...a, value: { ...a.value, gain: 1.2 } }).gain).toBeGreaterThan(
    leafStyle(a).gain,
  );
  expect(leafStyle(a).send).toBe(0.7);
  expect(leafStyle({ ...a, value: { ...a.value, lpf: 201 } }).shape).not.toBe(leafStyle(a).shape);
  f.notes = [a, b, { ...a, start: 0.5, end: 0.7, value: { note: 'c4' } }];
  const g = indexGarden(f),
    box = gardenLayout(g, 1300, 760),
    p = g.plants[0];
  expect(box.y(p, 60)).toBeLessThan(box.y(p, 48));
  for (const time of [0, 0.5, 7.25, 15.9])
    expect(box.y(p, 60, time) - leafRadius(2, box) * 1.8).toBeGreaterThan(84);
  const unpitched = indexGarden({
    ...f,
    notes: f.notes.map((n) => ({ ...n, value: { gain: 0.3 } })),
  });
  const unpitchedBox = gardenLayout(unpitched, 1300, 760);
  expect(leafRadius(0.3, box)).toBe(leafRadius(0.3, unpitchedBox));
  expect(leafRadius(1.2, box)).toBeGreaterThan(leafRadius(0.3, box));
  expect(box.y(p, 48, a.start) - box.vineY(p, Math.floor(a.start))).toBeCloseTo(
    box.y(p, 48, b.start) - box.vineY(p, Math.floor(b.start)),
    10,
  );
  expect(box.sprigY(p, a.start) - box.vineY(p, Math.floor(a.start))).toBeCloseTo(
    box.sprigY(p, b.start) - box.vineY(p, Math.floor(b.start)),
    10,
  );
  expect(gardenLayout(indexGarden({ ...f, now: 0.6 }), 1300, 760).y(p, 48)).toBe(box.y(p, 48));
  expect(gardenLayout(indexGarden({ ...f, now: 0.9 }), 1300, 760).y(p, 48)).toBe(box.y(p, 48));
});
it('crowds become exact-pitch counted clusters without dropping duplicate or carried records', () => {
  for (const f of corpus.values()) {
    const g = indexGarden(f);
    for (const [width, height] of [
      [1300, 760],
      [560, 469],
    ]) {
      const box = gardenLayout(g, width, height),
        clusters = leafClusters(g, box);
      const tags = clusterTags(clusters, box, (text) => text.length * 7);
      expect(tags.placed.length + tags.hidden).toBe(
        clusters.filter((c) => c.leaves.length > 1).length,
      );
      for (const tag of tags.placed) {
        for (const c of clusters) {
          const x = box.x(c.start),
            y = box.y(c.plant, c.pitch, c.start),
            r = leafRadius(c.gain, box);
          expect(
            tag.x - 3 >= x + 2.4 * r + 3 ||
              tag.x - 3 + tag.width <= x - 2.4 * r - 3 ||
              tag.y + 4 <= y - 2 * r - 3 ||
              tag.y - 12 >= y + 1.2 * r + 3,
          ).toBe(true);
        }
      }
      expect(clusters.reduce((n, c) => n + c.leaves.length, 0)).toBe(scoredNotes(f.notes).length);
      for (const c of clusters) {
        expect(new Set(c.leaves.map((l) => l.pitch)).size).toBe(1);
        expect(c.leaves.every((l) => Number.isFinite(box.y(c.plant, l.pitch)))).toBe(true);
      }
      if (f === corpus.get('micro-dense-64'))
        expect(clusters.some((c) => c.leaves.length >= 32)).toBe(true);
    }
  }
  const f = scoreFrame();
  f.notes = Array.from({ length: 3 }, () => ({
    instrument: '0',
    start: 0,
    end: 1,
    hasOnset: false,
    value: {},
  }));
  const g = indexGarden(f);
  expect(g.fragments).toBe(3);
  expect(leafClusters(g, gardenLayout(g, 560, 469))[0].leaves.length).toBe(3);
});
it('states partial query coverage and moves the whole-song range without assuming an unarranged repeat', () => {
  const f = corpus.get('real-dubstep-arranged')!;
  expect(gardenRange({ ...f, now: 29 })).toEqual([28, 56]);
  expect(gardenRange({ ...f, sections: [], now: 17 })).toEqual([16, 32]);
  const partial = indexGarden({ ...f, from: 8, to: 12 });
  expect([partial.knownFrom, partial.knownTo]).toEqual([8, 12]);
  expect(gardenMoment(indexGarden(f), [], -1).grown).toBe(0);
});
