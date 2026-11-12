import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { instruments, walk, type Doc, type Setting } from '../src/document';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { queryEventsNode } from './node-query';
import { setValue } from '../src/document/edits/values-set';
import { insertValue } from '../src/document/edits/values-insert';
import { removeValue } from '../src/document/edits/values-remove';
import { moveValue } from '../src/document/edits/values-move';
import { changeGroup } from '../src/document/edits/values-group';
import { toggleRest } from '../src/document/edits/values-rest';
import { setModifier } from '../src/document/edits/values-modifier';
import { replaceChunk } from '../src/document/edits/values-chunk';
import { convertValues } from '../src/document/edits/values-convert';
import { printSteps } from '../src/import/mini';
const load = (s: string) => importStrudel(s).doc;
function settings(doc: Doc) {
  const result: Setting[] = [];
  walk(doc, (n) => {
    if ('value' in n && 'name' in n) result.push(n as Setting);
  });
  return result;
}
function good(result: ReturnType<typeof setValue>): Doc {
  if ('ok' in result) throw Error(result.reason);
  return result;
}
const notation = (doc: Doc) => {
  const c = settings(doc)[0].value.core;
  if (c.kind !== 'sequence') throw Error('sequence expected');
  expect(c.notation).toBe(printSteps(c.steps));
  return c.notation;
};
it('edits nested values, lists, groups, rests, modifiers and chunks without mutating siblings', () => {
  const doc = load(
    'note("c e").gain(".8 .5 [.3 .9] <.1 .2> [.4,.6] .7!2? .2@2 {.1 .2}%2"); note(60).s("sine")',
  );
  const id = settings(doc)[0].id,
    before = JSON.stringify(doc);
  const edit = (f: (d: Doc) => ReturnType<typeof setValue>) => {
    const next = good(f(doc));
    expect(next.body[1]).toBe(doc.body[1]);
    expect(JSON.stringify(doc)).toBe(before);
    notation(next);
    return next;
  };
  expect(notation(edit((d) => setValue(d, id, [2, 1], '.4')))).toContain('[.3 .4]');
  expect(notation(edit((d) => insertValue(d, id, [2], 1, '.4')))).toContain('[.3 .4 .9]');
  expect(notation(edit((d) => removeValue(d, id, [2, 0])))).toContain('[.9]');
  expect(notation(edit((d) => moveValue(d, id, [2, 0], 1)))).toContain('[.9 .3]');
  expect(notation(edit((d) => changeGroup(d, id, [3], 'sub')))).toContain('[.1 .2]');
  expect(notation(edit((d) => changeGroup(d, id, [2], 'alternate')))).toContain('<.3 .9>');
  const off = edit((d) => toggleRest(d, id, [0]));
  expect(notation(off)).toMatch(/^~ /);
  expect(notation(good(toggleRest(off, id, [0])))).toBe(notation(doc));
  for (const [name, value] of [
    ['weight', 3],
    ['repeat', 4],
    ['chance', 0.25],
  ] as const)
    expect(notation(edit((d) => setModifier(d, id, [5], name, value)))).toContain(
      name === 'repeat' ? '!4' : name === 'chance' ? '?0.25' : '@2',
    );
  expect(notation(edit((d) => replaceChunk(d, id, [7], '<.2 .8>')))).toContain('<.2 .8>');
  const a = settings(doc)[0].value.core,
    b = settings(good(setValue(doc, id, [0], '.6')))[0].value.core;
  if (a.kind === 'sequence' && b.kind === 'sequence') expect(a.steps[2]).toBe(b.steps[2]);
  expect(setValue(doc, id, [0], '.8')).toBe(doc);
});
it('refuses stale paths, invalid values, invalid operations and invalid notation', () => {
  const doc = load('note(60).gain(".8 [.3] .4@2 {.1 .2}%2")'),
    id = settings(doc)[0].id;
  for (const result of [
    setValue(doc, 'gone', [0], '1'),
    setValue(doc, doc.body[0].id, [0], '1'),
    setValue(doc, id, [9], '1'),
    setValue(doc, id, [0, 0], '1'),
    setValue(doc, id, [-1], '1'),
    setValue(doc, id, [0], '[1 2]'),
    setValue(doc, id, [1], '1'),
    insertValue(doc, id, [], 99),
    insertValue(doc, id, [0], 0),
    removeValue(doc, id, [1, 0]),
    moveValue(doc, id, [0], 99),
    changeGroup(doc, id, [0], 'sub'),
    toggleRest(doc, id, [1]),
    setModifier(doc, id, [0], 'repeat', 0),
    setModifier(doc, id, [0], 'repeat', 1.5),
    setModifier(doc, id, [0], 'weight', Infinity),
    setModifier(doc, id, [0], 'chance', 2),
    setModifier(doc, id, [1], 'chance', 0.5),
    replaceChunk(doc, id, [0], '1'),
    replaceChunk(doc, id, [3], '['),
  ])
    expect(result).toMatchObject({ ok: false, reason: expect.any(String) });
  expect(convertValues(doc, 'gone', 'constant')).toHaveProperty('ok', false);
  expect(convertValues(load('note(60).gain(sine)'), id, 'values')).toHaveProperty('ok', false);
});
it('converts a constant to alternating values and back, with the same node ids', () => {
  const doc = load('note(60).gain(.5)'),
    id = settings(doc)[0].id;
  const next = good(convertValues(doc, id, 'values'));
  expect(notation(next)).toBe('<0.5 0.5>');
  const constant = good(convertValues(good(setValue(next, id, [0, 1], '.8')), id, 'constant'));
  expect(settings(constant)[0].value).toEqual(settings(doc)[0].value);
});
it('real techno: the alternating room send changes in the right cycles; every other instrument stays identical', async () => {
  const original = load(readFileSync('corpus/programs/real-techno.strudel', 'utf8'));
  const setting = settings(original).find(
    (s) => s.value.core.kind === 'constant' && s.name === 'room',
  )!;
  const doc = good(convertValues(original, setting.id, 'values'));
  expect(setting).toBeDefined();
  const next = good(setValue(doc, setting.id, [0, 1], '0.987'));
  const rows = instruments(doc),
    owner = rows.find((r) =>
      r.pattern.layers.some(
        (l) => l.kind === 'settings' && l.settings.some((s) => s.id === setting.id),
      ),
    )!;
  expect(owner).toBeDefined();
  for (const row of rows) {
    const [a, b] = await Promise.all(
      [doc, next].map((d) => queryEventsNode(generate(d, { only: row.id }), 0, 16)),
    );
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const stable = (v: unknown) => JSON.stringify(v);
    if (row.id !== owner.id)
      expect(b.events.map(stable).sort()).toEqual(a.events.map(stable).sort());
    else {
      expect(b.events.length).toBeGreaterThan(0);
      expect(b.events.length).toBe(a.events.length);
      for (let i = 0; i < a.events.length; i++) {
        const old = a.events[i],
          changed = b.events[i];
        expect({ ...changed, value: undefined }).toEqual({ ...old, value: undefined });
        const value = changed.value as Record<string, unknown>,
          prior = old.value as Record<string, unknown>;
        expect({ ...value, room: undefined }).toEqual({ ...prior, room: undefined });
        expect(value.room).toBe(Math.floor(changed.part[0]) % 2 ? 0.987 : prior.room);
      }
    }
  }
});
const roundTrips: [string, string, (d: Doc, id: string) => ReturnType<typeof setValue>, string][] =
  [
    ['set', '.2 [.4 .6]', (d, id) => setValue(d, id, [1, 0], '.8'), '.2 [.8 .6]'],
    ['insert', '.2 [.4 .6]', (d, id) => insertValue(d, id, [1], 1, '.8'), '.2 [.4 .8 .6]'],
    ['remove', '.2 [.4 .6]', (d, id) => removeValue(d, id, [1, 0]), '.2 [.6]'],
    ['move', '.2 [.4 .6]', (d, id) => moveValue(d, id, [1, 0], 1), '.2 [.6 .4]'],
    ['group', '.2 [.4 .6]', (d, id) => changeGroup(d, id, [1], 'alternate'), '.2 <.4 .6>'],
    ['rest', '.2 [.4 .6]', (d, id) => toggleRest(d, id, [1, 0]), '.2 [~ .6]'],
    ['weight', '.2 [.4 .6]', (d, id) => setModifier(d, id, [0], 'weight', 3), '.2@3 [.4 .6]'],
    ['repeat', '.2 [.4 .6]', (d, id) => setModifier(d, id, [0], 'repeat', 3), '.2!3 [.4 .6]'],
    ['chance', '.2 [.4 .6]', (d, id) => setModifier(d, id, [0], 'chance', 0.75), '.2?0.75 [.4 .6]'],
    ['chunk', '.2 [.4|.6]', (d, id) => replaceChunk(d, id, [1], '<.4 .8>'), '.2 <.4 .8>'],
    ['constant', '<.2 .8>', (d, id) => convertValues(d, id, 'constant'), '.2'],
  ];
for (const [name, pattern, operation, expected] of roundTrips)
  it(`worker round trip: ${name}`, async () => {
    const source = (p: string) => `stack(note("c4*8").s("sine").gain("${p}"),s("hh*3").gain(.17))`;
    const doc = load(source(pattern)),
      id = settings(doc).find((s) => s.name === 'gain')!.id;
    const before = JSON.stringify(doc),
      next = good(operation(doc, id));
    expect(JSON.stringify(doc)).toBe(before);
    const result = await queryEventsNode(generate(next), 0, 4),
      reference = await queryEventsNode(source(expected), 0, 4),
      original = await queryEventsNode(generate(doc), 0, 4);
    expect(result.error).toBeNull();
    expect(reference.error).toBeNull();
    expect(original.error).toBeNull();
    const multiset = (events: typeof result.events) => events.map((e) => JSON.stringify(e)).sort();
    expect(multiset(result.events)).toEqual(multiset(reference.events));
    for (const row of instruments(doc).slice(1))
      expect(await queryEventsNode(generate(next, { only: row.id }), 0, 4)).toEqual(
        await queryEventsNode(generate(doc, { only: row.id }), 0, 4),
      );
  });

it('switching a repeated weighted chance value off and on restores its full value and duration', () => {
  const doc = load('note(60).gain(".4!3@2?0.2 .8")'),
    id = settings(doc)[0].id;
  const off = good(toggleRest(doc, id, [0]));
  expect(notation(off)).toBe('~@4 .8');
  expect(notation(good(toggleRest(off, id, [0])))).toBe(notation(doc));
});
it('making a saved rest constant keeps its value without its pattern annotations', () => {
  const doc = load('note(60).gain(".4!3?0.2 .8")'),
    id = settings(doc)[0].id;
  const next = good(convertValues(good(toggleRest(doc, id, [0])), id, 'constant'));
  expect(settings(next)[0].value.core).toEqual({ kind: 'constant', value: 0.4 });
});
