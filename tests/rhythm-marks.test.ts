import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { instruments, type Doc } from '../src/document';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { parseSteps, printSteps } from '../src/import/mini';
import { sequenceOwner } from '../src/document/edits/step-shared';
import { speedRhythm } from '../src/document/edits/rhythm-speed';
import { rhythmMarks, rhythmNumber } from '../src/document/edits/rhythm-marks';
import { euclidRhythm } from '../src/document/edits/rhythm-euclid';
import { joinRhythm } from '../src/document/edits/rhythm-join';
import { removeRhythm } from '../src/document/edits/rhythm-remove';
import { rhythmPulses } from '../src/document/edits/rhythm-pulses';
import { queryEventsNode } from './node-query';
const load = (text = 'c2 d2') =>
  importStrudel(`const bass=note("${text}").s("sine"); stack(bass,s("bd"))`).doc;
const id = (d: Doc) => `${instruments(d)[0].pattern.id}:rhythm`;
const ok = (d: Doc | { ok: false; reason: string }): Doc => {
  if ('ok' in d) throw Error(d.reason);
  return d;
};
const text = (d: Doc) => {
  const c = sequenceOwner(d, id(d))!.core;
  if (c.kind !== 'sequence') throw Error('No sequence');
  return printSteps(c.steps);
};
function freeze(d: unknown) {
  if (d && typeof d === 'object') {
    Object.values(d).forEach(freeze);
    Object.freeze(d);
  }
}
const cases = [
  ['faster', (d: Doc) => speedRhythm(d, id(d), [0], 'faster', 2), [0, 0.25, 0.5]],
  ['slower', (d: Doc) => speedRhythm(d, id(d), [0], 'slower', 2), [0, 0.5]],
  ['repeat group', (d: Doc) => speedRhythm(d, id(d), [0], 'repeat', 2), [0, 1 / 3, 2 / 3]],
  ['fractional length', (d: Doc) => speedRhythm(d, id(d), [0], 'weight', 0.5), [0, 1 / 3]],
  ['euclid', (d: Doc) => euclidRhythm(d, id(d), [0], 3, 8), [0, 3 / 16, 6 / 16, 0.5]],
  [
    'rotated euclid',
    (d: Doc) => euclidRhythm(d, id(d), [0], 3, 8, 1),
    [1 / 16, 4 / 16, 7 / 16, 0.5],
  ],
  ['plain again', (d: Doc) => euclidRhythm(d, id(d), [0], null), [0, 0.5]],
  ['no faster', (d: Doc) => speedRhythm(d, id(d), [0], 'faster', null), [0, 0.5]],
  ['join', (d: Doc) => joinRhythm(d, id(d), [0]), [0, 0.5]],
  ['collapse', (d: Doc) => removeRhythm(d, id(d), [0, 0]), [0, 0.5]],
] as const;
for (const [name, edit, onsets] of cases)
  it(`${name}: immutable, independent onsets, only edited instrument changes through worker`, async () => {
    const before = load(
      name === 'join' || name === 'collapse'
        ? '[~ c2] d2'
        : name === 'plain again'
          ? 'c2(3,8) d2'
          : name === 'no faster'
            ? 'c2*2 d2'
            : name === 'repeat group'
              ? '[c2] d2'
              : undefined,
    );
    const snapshot = JSON.stringify(before);
    freeze(before);
    const after = ok(edit(before));
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after.body.at(-1)).toBe(before.body.at(-1));
    const rows = instruments(before);
    const actual = await queryEventsNode(generate(after, { only: rows[0].id }), 0, 1);
    expect(actual.error).toBeNull();
    expect(
      actual.events
        .filter((e) => e.whole && e.part[0] === e.whole[0])
        .map((e) => e.whole![0])
        .sort((a, b) => a - b),
    ).toEqual([...onsets].sort((a, b) => a - b));
    expect(await queryEventsNode(generate(after, { only: rows[1].id }), 0, 2)).toEqual(
      await queryEventsNode(generate(before, { only: rows[1].id }), 0, 2),
    );
    expect(text(importStrudel(generate(after)).doc)).toBe(text(after));
  });
it('validates paths and literal marks; fractions, none, mark order and Euclid restoration', () => {
  const d = load();
  freeze(d);
  expect(rhythmNumber('3/2')).toBe(1.5);
  expect(rhythmNumber('1/0')).toBe(Infinity);
  expect(rhythmNumber('2x')).toBeNaN();
  for (const n of [0, -1, NaN, Infinity])
    expect(speedRhythm(d, id(d), [0], 'faster', n)).toHaveProperty('ok', false);
  expect(speedRhythm(d, id(d), [0], 'repeat', 1.5)).toHaveProperty('ok', false);
  expect(speedRhythm(d, id(d), [9], 'weight', 2)).toHaveProperty('ok', false);
  expect(speedRhythm(load('c2*<1 2>'), id(d), [0], 'faster', 2)).toHaveProperty('ok', false);
  for (const args of [
    [4, 3, 0],
    [1, 0, 0],
    [1.5, 8, 0],
    [3, 8, 0.5],
    [3, 1025, 0],
  ])
    expect(euclidRhythm(d, id(d), [0], ...(args as [number, number, number]))).toHaveProperty(
      'ok',
      false,
    );
  expect(euclidRhythm(d, id(d), [9], 3)).toHaveProperty('ok', false);
  expect(euclidRhythm(load('c2(<2 3>,8)'), id(d), [0], 3)).toHaveProperty('ok', false);
  expect(euclidRhythm(d, id(d), [0], null)).toHaveProperty('ok', false);
  expect(joinRhythm(d, id(d), [0])).toHaveProperty('ok', false);
  expect(text(ok(joinRhythm(load('[~ ~]@3 d2'), id(d), [0])))).toBe('~@3 d2');
  const marked = load('[c2 d2]*2/3!2@3 e2');
  expect(rhythmMarks(parseSteps(text(marked))[0])?.weight).toBe(4);
  expect(text(ok(speedRhythm(marked, id(marked), [0], 'faster', null)))).toBe('[c2 d2]/3!2@3 e2');
  const weighted = ok(speedRhythm(load('c2!2 d2'), id(d), [0], 'weight', 0.5));
  expect(text(weighted)).toBe('c2!2@-0.5 d2');
  expect(rhythmMarks(parseSteps(text(weighted))[0])?.weight).toBe(0.5);
  expect(speedRhythm(d, id(d), [0], 'faster', 1e21)).toHaveProperty('ok', false);
  const fastEuclid = ok(euclidRhythm(load('c2*2 d2'), id(d), [0], 3));
  expect(text(fastEuclid)).toBe('c2(3,8,0)*2 d2');
  expect(text(ok(euclidRhythm(fastEuclid, id(d), [0], 4, 8, -1)))).toBe('c2(4,8,-1)*2 d2');
  expect(text(ok(euclidRhythm(fastEuclid, id(d), [0], null)))).toBe('c2*2 d2');
  const e = ok(euclidRhythm(d, id(d), [0], 3));
  expect(text(ok(euclidRhythm(e, id(e), [0], null)))).toBe(text(d));
  for (const group of ['<c2 d2>', '[c2,d2]'])
    expect(text(ok(removeRhythm(load(group), id(d), [0, 0])))).toBe('d2');
});
for (const source of [
  'c2*2',
  '[c2 d2]*2',
  '<c2 d2>*2',
  '<c2 d2>!2',
  '[c2 d2]/2',
  'c2/2',
  'c2*1.5',
  '[c2*2 d2]/2',
  'c2(3,8)',
  '[c2 d2](3,8)',
  '[c2 ~](5,8)',
  '<c2 d2>(3,8)',
  'c2(3,8)*2',
  'c2(5,8)',
  'c2(3,8,-1)',
  'c2(0,8)',
  'c2(8,8)',
])
  it(`true hit fragments: ${source}`, async () => {
    const step = parseSteps(source)[0];
    const actual = await queryEventsNode(`note("${source}")`, 0, 4);
    expect(actual.error).toBeNull();
    const pulses = Array.from({ length: 4 }, (_, c) => rhythmPulses(step, c, c + 1)!)
      .flat()
      .filter((p) => p.value !== undefined);
    const round = (n: number) => Math.round(n * 1e9) / 1e9;
    const key = (whole: number[], part: number[], value: unknown) =>
      JSON.stringify([whole.map(round), part.map(round), value]);
    expect(pulses.map((p) => key([p.start, p.end], [p.from, p.to], p.value)).sort()).toEqual(
      actual.events.map((e) => key(e.whole!, e.part, (e.value as { note: string }).note)).sort(),
    );
  });
it('real house: Euclid hits replace one bass step; unrelated instruments remain exact', async () => {
  const before = importStrudel(
    readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'),
  ).doc;
  const rows = instruments(before),
    bass = rows.find((r) => r.name === 'bass')!;
  freeze(before);
  const after = ok(euclidRhythm(before, `${bass.pattern.id}:rhythm`, [0], 3, 8));
  for (const row of rows) {
    const a = await queryEventsNode(generate(before, { only: row.id }), 0, 28),
      b = await queryEventsNode(generate(after, { only: row.id }), 0, 28);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    if (row.id !== bass.id) expect(b.events).toEqual(a.events);
    else {
      const old = a.events.filter((e) => e.whole && e.part[0] === e.whole[0]);
      const expected = old.flatMap((e) =>
        e.whole![0] % 1 === 0
          ? [0, 3, 6].map((i) => ({
              start: e.whole![0] + ((e.whole![1] - e.whole![0]) * i) / 8,
              end: e.whole![0] + ((e.whole![1] - e.whole![0]) * (i + 1)) / 8,
              value: e.value,
            }))
          : [{ start: e.whole![0], end: e.whole![1], value: e.value }],
      );
      const key = (e: { start: number; end: number; value: unknown }) => JSON.stringify(e);
      expect(
        b.events
          .filter((e) => e.whole && e.part[0] === e.whole[0])
          .map((e) => key({ start: e.whole![0], end: e.whole![1], value: e.value }))
          .sort(),
      ).toEqual(expected.map(key).sort());
    }
  }
});
