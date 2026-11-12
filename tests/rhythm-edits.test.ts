import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { instruments, type Doc, type Step } from '../src/document';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { parseSteps, printSteps } from '../src/import/mini';
import { sequenceOwner } from '../src/document/edits/step-shared';
import { setRhythmValue } from '../src/document/edits/rhythm-set';
import { restRhythm } from '../src/document/edits/rhythm-rest';
import { splitRhythm } from '../src/document/edits/rhythm-split';
import { mergeRhythm } from '../src/document/edits/rhythm-merge';
import { rhythmModifier } from '../src/document/edits/rhythm-modifier';
import { insertRhythm } from '../src/document/edits/rhythm-insert';
import { removeRhythm } from '../src/document/edits/rhythm-remove';
import { moveRhythm } from '../src/document/edits/rhythm-move';
import { wrapRhythm } from '../src/document/edits/rhythm-wrap';
import { replaceRhythmChunk } from '../src/document/edits/rhythm-chunk';
import { queryEventsNode } from './node-query';
const load = (text = 'c2 d2') =>
  importStrudel(`const bass=note(${JSON.stringify(text)}).s("sine"); stack(bass,s("bd"))`).doc;
const id = (d: Doc) => `${instruments(d)[0].pattern.id}:rhythm`;
const steps = (d: Doc) => {
  const c = sequenceOwner(d, id(d))!.core;
  if (c.kind !== 'sequence') throw Error('No sequence');
  return c.steps;
};
const ok = (d: Doc | { ok: false; reason: string }) => {
  if ('ok' in d) throw Error(d.reason);
  return d;
};
function freeze(value: unknown) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}
const edits = [
  ['value', (d: Doc) => setRhythmValue(d, id(d), [0], 'e2'), 'e2 d2'],
  ['rest', (d: Doc) => restRhythm(d, id(d), [0]), '~ d2'],
  ['split', (d: Doc) => splitRhythm(d, id(d), [0], 3), '[c2 c2 c2] d2'],
  ['weight', (d: Doc) => rhythmModifier(d, id(d), [0], 'weight', 3), 'c2@3 d2'],
  ['repeat', (d: Doc) => rhythmModifier(d, id(d), [0], 'repeat', 2), 'c2!2 d2'],
  ['insert', (d: Doc) => insertRhythm(d, id(d), [], 1, 'e2'), 'c2 e2 d2'],
  ['remove', (d: Doc) => removeRhythm(d, id(d), [0]), 'd2'],
  ['move', (d: Doc) => moveRhythm(d, id(d), [0], 1), 'd2 c2'],
  ['turns', (d: Doc) => wrapRhythm(d, id(d), [0], 'alternate', 'e2'), '<c2 e2> d2'],
  ['together', (d: Doc) => wrapRhythm(d, id(d), [0], 'together', 'e2'), '[c2,e2] d2'],
] as const;
for (const [name, edit, expected] of edits)
  it(`${name}: immutable edit, shared untouched branch and worker round trip`, async () => {
    const before = load();
    freeze(before);
    const next = ok(edit(before));
    expect(printSteps(steps(next))).toBe(expected);
    expect(printSteps(steps(before))).toBe('c2 d2');
    expect(next.body.at(-1)).toBe(before.body.at(-1));
    expect(steps(next).at(-1)).toBe(
      name === 'remove' || name === 'move' || name === 'insert'
        ? steps(before)[name === 'move' ? 0 : 1]
        : steps(before)[1],
    );
    const actual = await queryEventsNode(generate(next, { only: instruments(next)[0].id }), 0, 4);
    const direct = await queryEventsNode(`note(${JSON.stringify(expected)}).s("sine")`, 0, 4);
    expect(actual.error).toBeNull();
    expect(direct.error).toBeNull();
    expect(actual.events).toEqual(direct.events);
    const other = instruments(before)[1].id;
    expect(await queryEventsNode(generate(next, { only: other }), 0, 4)).toEqual(
      await queryEventsNode(generate(before, { only: other }), 0, 4),
    );
  });
it('restore retains saved value, repeat and weight, merge confirms nested loss and preserves the slot', () => {
  const d = load('c2!2@3 d2');
  expect(steps(ok(restRhythm(ok(restRhythm(d, id(d), [0])), id(d), [0])))).toEqual(steps(d));
  const split = ok(splitRhythm(d, id(d), [0], 2));
  expect(steps(split)[0]).toMatchObject({ kind: 'sub', weight: 4 });
  expect(printSteps(steps(ok(mergeRhythm(split, id(d), [0]))))).toBe('c2@4 d2');
  const nested = load('[c2 [d2 e2]]');
  expect(mergeRhythm(nested, id(nested), [0])).toMatchObject({ ok: false });
  expect(printSteps(steps(ok(mergeRhythm(nested, id(nested), [0], true))))).toBe('c2@1');
  for (const kind of ['alternate', 'together'] as const) {
    const wrapped = ok(wrapRhythm(d, id(d), [0], kind, 'e2'));
    expect(steps(wrapped)[0]).toMatchObject({ kind: 'sub', weight: 4 });
    const simple = ok(wrapRhythm(load(), id(load()), [0], kind, 'e2'));
    expect(steps(ok(removeRhythm(simple, id(simple), [0, 1])))[0]).toEqual({
      kind: 'value',
      value: 'c2',
    });
    expect(printSteps(steps(ok(wrapRhythm(simple, id(simple), [0], kind, 'f2'))))).toContain('f2');
    expect(moveRhythm(simple, id(simple), [0, 0], 1)).not.toHaveProperty('ok');
  }
});
it('validates values, paths, counts, kinds, last-part removal and chunk parsing', () => {
  const d = load(),
    target = id(d);
  for (const value of ['hello', 'c', 'c2 d2', '[c2]', '', 'Infinity'])
    expect(setRhythmValue(d, target, [0], value)).toHaveProperty('ok', false);
  for (const value of ['61', '-2.5', 'db3', 'F#4'])
    expect(setRhythmValue(d, target, [0], value)).not.toHaveProperty('ok');
  const sound = importStrudel('s("bd")').doc,
    sid = id(sound);
  expect(setRhythmValue(sound, sid, [0], 'unknownSound')).not.toHaveProperty('ok');
  const n = importStrudel('n("0 1").s("bd")').doc;
  expect(setRhythmValue(n, id(n), [0], 'c2')).toHaveProperty('ok', false);
  for (const count of [1, 9, 2.5, NaN])
    expect(splitRhythm(d, target, [0], count)).toHaveProperty('ok', false);
  for (const count of [0, 1.5, Infinity])
    expect(rhythmModifier(d, target, [0], 'weight', count)).toHaveProperty('ok', false);
  for (const edit of [
    () => setRhythmValue(d, 'missing:rhythm', [0], 'c2'),
    () => restRhythm(d, target, [9]),
    () => restRhythm(d, target, []),
    () => setRhythmValue(d, target, [0, 0], 'e2'),
    () => removeRhythm(load('c2'), id(load('c2')), [0]),
    () => removeRhythm(d, target, [-1]),
    () => moveRhythm(d, target, [0], -1),
    () => insertRhythm(d, target, [], 8, 'c2'),
    () => insertRhythm(d, target, [], 0, 'bad'),
    () => mergeRhythm(d, target, [0]),
    () => replaceRhythmChunk(d, target, [0], 'c2'),
    () => rhythmModifier(load('[c2 d2]'), id(load('[c2 d2]')), [0], 'repeat', 2),
  ])
    expect(edit()).toHaveProperty('ok', false);
  expect(setRhythmValue(d, target, [0], 'c2')).toBe(d);
  expect(moveRhythm(d, target, [0], 0)).toBe(d);
  const chunk = load('c2*2'),
    cid = id(chunk);
  for (const text of ['[', ''])
    expect(replaceRhythmChunk(chunk, cid, [0], text)).toHaveProperty('ok', false);
  expect(printSteps(steps(ok(replaceRhythmChunk(chunk, cid, [0], '[d2 e2]'))))).toBe('[d2 e2]');
  expect(splitRhythm(chunk, cid, [0], 2)).toHaveProperty('ok', false);
  expect(wrapRhythm(chunk, cid, [0], 'alternate', 'd2')).toHaveProperty('ok', false);
});
function firstValue(list: Step[], parent: number[] = []): number[] | undefined {
  for (let i = 0; i < list.length; i++) {
    const s = list[i],
      p = [...parent, i];
    if (s.kind === 'value') return p;
    if (s.kind === 'sub' || s.kind === 'alternate' || s.kind === 'together') {
      const found = firstValue(s.steps, p);
      if (found) return found;
    }
  }
}
for (const [file, name] of [
  ['real-house-arranged', 'bass'],
  ['real-house-arranged', 'drums'],
  ['real-ambient', 'notes'],
])
  it(`${file} ${name}: only intended starts change value; every other instrument is unchanged`, async () => {
    const before = importStrudel(readFileSync(`corpus/programs/${file}.strudel`, 'utf8')).doc;
    const rows = instruments(before),
      row =
        name === 'drums'
          ? rows.find((r) => {
              const c = sequenceOwner(before, `${r.pattern.id}:rhythm`);
              return c?.control === 's' && c.core.kind === 'sequence' && firstValue(c.core.steps);
            })!
          : name === 'notes'
            ? rows.find((r) => {
                const c = sequenceOwner(before, `${r.pattern.id}:rhythm`);
                return (
                  c?.control === 'note' && c.core.kind === 'sequence' && firstValue(c.core.steps)
                );
              })!
            : rows.find((r) => r.name === name)!;
    const target = `${row.pattern.id}:rhythm`,
      core = sequenceOwner(before, target)!.core;
    if (core.kind !== 'sequence') throw Error('Expected sequence');
    const path = firstValue(core.steps)!;
    const replacement = name === 'drums' ? 'unknownSound' : '83';
    freeze(before);
    const after = ok(setRhythmValue(before, target, path, replacement));
    const onset = (r: Awaited<ReturnType<typeof queryEventsNode>>) =>
      r.events
        .filter((e) => e.whole && e.whole[0] === e.part[0])
        .map((e) => ({ span: e.whole!, value: e.value as Record<string, unknown> }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    for (const instrument of rows) {
      const [a, b] = await Promise.all(
        [before, after].map((d) => queryEventsNode(generate(d, { only: instrument.id }), 0, 28)),
      );
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();
      const old = onset(a),
        next = onset(b);
      if (instrument.id !== row.id) expect(next).toEqual(old);
      else {
        expect(old.length).toBeGreaterThan(0);
        expect(next.length).toBe(old.length);
        const key = name === 'drums' ? 's' : 'note';
        const changed = next.filter(
          (e) => !old.some((o) => JSON.stringify(o) === JSON.stringify(e)),
        );
        expect(changed.length).toBeGreaterThan(0);
        for (const e of changed) {
          expect(String(e.value[key])).toBe(replacement);
          expect(
            old.some(
              (o) =>
                JSON.stringify(o.span) === JSON.stringify(e.span) &&
                JSON.stringify({ ...o.value, [key]: e.value[key] }) === JSON.stringify(e.value),
            ),
          ).toBe(true);
        }
      }
    }
    expect(parseSteps(core.notation)).toEqual(core.steps);
  });
