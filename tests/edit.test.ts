import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { describeTarget, setConstant } from '../src/document/edit';
import { instruments, walk, type Doc, type Setting } from '../src/document';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { queryEventsNode } from './node-query';
import { controlInfo, sliderValue, fromSlider } from '../src/editor/controls';
import { history, push, undo, redo } from '../src/editor/history';
import { pending, transition } from '../src/editor/pending';
const load = (source: string) => importStrudel(source).doc;
function settings(doc: Doc) {
  const result: Setting[] = [];
  walk(doc, (node) => {
    if ('value' in node && 'name' in node) result.push(node as Setting);
  });
  return result;
}
const changed = (doc: Doc, id: string, value: number) => {
  const result = setConstant(doc, id, value);
  if ('ok' in result) throw Error(result.reason);
  return result;
};
it('edits definition and section-local targets independently, preserving untouched identity', () => {
  const doc = load(
    'const chords=note(60).lpf(450); const intro=stack(chords.lpf(600)); arrange([4,intro],[4,chords])',
  );
  const [definition, local] = settings(doc);
  expect(describeTarget(doc, definition.id).breadcrumb).toEqual(['chords', 'lpf']);
  expect(describeTarget(doc, local.id).breadcrumb).toEqual(['chords', 'in intro', 'lpf']);
  const next = changed(doc, local.id, 900);
  expect(doc.body[0]).toBe(next.body[0]);
  expect(describeTarget(next, definition.id).value).toBe(450);
  expect(describeTarget(next, local.id).value).toBe(900);
  expect(describeTarget(doc, local.id).value).toBe(600);
  expect(changed(doc, definition.id, 800).body[1]).toBe(doc.body[1]);
});
it('refuses missing, non-setting, patterned, layered, signal and source targets without throwing', () => {
  const doc = load('note(60).lpf(sine.range(400,2000)).gain(".1 .8").pan(pure(.5)).room(()=>1)');
  expect(setConstant(doc, 'missing', 1)).toMatchObject({ ok: false });
  expect(setConstant(doc, doc.body[0].id, 1)).toMatchObject({ ok: false });
  for (const s of settings(doc)) expect(setConstant(doc, s.id, 1)).toMatchObject({ ok: false });
  expect(describeTarget(doc, settings(doc)[0].id).reason).toBe('driven by a signal');
  expect(describeTarget(doc, settings(doc)[0].id).displayValue).toBe('400 to 2000');
  expect(describeTarget(doc, settings(doc)[1].id).reason).toBe('a pattern of values');
  expect(describeTarget(doc, settings(doc).at(-1)!.id).reason).toBe('source text');
  const simple = load('// comment is not a name\n$: note(60).gain(.5)');
  const id = settings(simple)[0].id;
  expect(describeTarget(simple, id)).toMatchObject({
    breadcrumb: ['Instrument 1', 'gain'],
    generated: true,
  });
  expect(setConstant(simple, id, Infinity)).toMatchObject({ ok: false });
  expect(setConstant(simple, id, 'bad type')).toMatchObject({ ok: false });
  settings(simple)[0].value.layers.push({
    id: 'layer',
    tier: 1,
    kind: 'rewrite',
    name: 'slow',
    args: [],
  });
  expect(setConstant(simple, id, 1)).toMatchObject({ ok: false });
});
it('allows text and boolean constants; control hints do not invent unknown ranges', () => {
  const doc = load("note(60).s('sine').gain(true)");
  // Imported strings are mini-patterns. This checks plain document string constants.
  settings(doc).find((s) => s.name === 's')!.value.core = { kind: 'constant', value: 'sine' };
  for (const s of settings(doc)) {
    const value = typeof describeTarget(doc, s.id).value === 'boolean' ? false : 'triangle';
    expect(setConstant(doc, s.id, value)).not.toHaveProperty('ok');
  }
  expect(controlInfo('cutoff')).toEqual(controlInfo('lpf'));
  expect(controlInfo('somethingNew')).toBeUndefined();
  expect(controlInfo('size')?.unit).toBe('');
  for (const name of ['lpf', 'gain']) {
    const info = controlInfo(name)!;
    expect(fromSlider(info, sliderValue(info, info.min))).toBeCloseTo(info.min);
    expect(fromSlider(info, sliderValue(info, info.max))).toBeCloseTo(info.max);
  }
});
it('bounds history, coalesces only the same gesture/target and discards redo on a new edit', () => {
  const a = load('note(60).gain(.5)'),
    id = settings(a)[0].id;
  const b = changed(a, id, 0.6),
    c = changed(a, id, 0.7),
    d = changed(a, id, 0.8);
  let h = history(a, 2);
  h = push(h, b, id, 'drag-1');
  h = push(h, c, id, 'drag-1');
  expect(h.past).toEqual([a]);
  expect(undo(h).present).toBe(a);
  expect(redo(undo(h)).present).toBe(c);
  h = push(h, d, id, 'drag-2');
  h = push(h, b, 'other', 'drag-2');
  expect(h.past).toEqual([c, d]);
  expect(push(undo(h), a, id).future).toEqual([]);
  expect(undo(history(a)).present).toBe(a);
});
it('pending begins immediately, survives supersession and clears only at the carrying/later revision', () => {
  const a = load('note(60).gain(.5)'),
    id = settings(a)[0].id,
    b = changed(a, id, 0.6),
    c = changed(a, id, 0.7);
  let p = transition(pending(a), { type: 'edit', doc: b, target: id, token: 1, playing: true });
  expect(p.entries[id].status).toBe('pending');
  p = transition(p, { type: 'sent', doc: b, token: 1, revision: 2 });
  p = transition(p, { type: 'edit', doc: c, target: id, token: 2, playing: true });
  p = transition(p, { type: 'swapped', revision: 2 });
  expect(p.entries[id].status).toBe('pending');
  expect(p.good).toBe(b);
  p = transition(p, { type: 'sent', doc: c, token: 2, revision: 3 });
  expect(transition(p, { type: 'swapped', revision: 1 }).entries[id].status).toBe('pending');
  expect(transition(p, { type: 'swapped', revision: 4 }).entries).toEqual({});
  // The first trigger can beat play() resolving with its revision.
  p = transition(p, { type: 'swapped', revision: 3 });
  expect(p.good).toBe(c);
});
it('stopped edits, stopping, loading, rejection and stale completion are explicit transitions', () => {
  const a = load('note(60).gain(.5)'),
    id = settings(a)[0].id,
    b = changed(a, id, 0.6);
  const edit = { type: 'edit', doc: b, target: id, token: 1, playing: true } as const;
  expect(transition(pending(a), { ...edit, playing: false })).toMatchObject({
    doc: b,
    good: b,
    entries: {},
  });
  let p = transition(pending(a), edit);
  expect(transition(p, { type: 'clear' }).entries).toEqual({});
  expect(transition(p, { type: 'load', doc: a }).doc).toBe(a);
  p = transition(p, { type: 'failed', token: 1, reason: 'bad swap' });
  expect(p.doc).toBe(a);
  expect(p.entries[id]).toMatchObject({ status: 'failed', reason: 'bad swap' });
  expect(transition(p, { type: 'failed', token: 999, reason: 'stale' })).toBe(p);
  let race = transition(pending(a), edit);
  race = transition(race, { type: 'swapped', revision: 3 });
  race = transition(race, { type: 'sent', token: 1, revision: 2, doc: b });
  expect(race.entries).toEqual({});
  expect(race.good).toBe(b);
  expect(transition(transition(pending(a), edit), { type: 'clear' }).good).toBe(b);
});
for (const file of ['real-house-arranged', 'real-techno'])
  it(`real worker round trip: ${file}`, async () => {
    const doc = load(readFileSync(`corpus/programs/${file}.strudel`, 'utf8'));
    const rows = instruments(doc);
    const row = rows.find((r) =>
      r.pattern.layers.some(
        (l) =>
          l.kind === 'settings' &&
          l.settings.some(
            (s) => s.value.core.kind === 'constant' && typeof s.value.core.value === 'number',
          ),
      ),
    )!;
    const setting = row.pattern.layers
      .flatMap((l) => (l.kind === 'settings' ? l.settings : []))
      .find((s) => s.value.core.kind === 'constant' && typeof s.value.core.value === 'number')!;
    const value = setting.name === 'lpf' ? 987 : 0.4321,
      next = changed(doc, setting.id, value);
    const stable = (x: unknown): string =>
      Array.isArray(x)
        ? `[${x.map(stable)}]`
        : x && typeof x === 'object'
          ? `{${Object.entries(x)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => `${k}:${stable(v)}`)}}`
          : JSON.stringify(x);
    for (const instrument of rows) {
      const [a, b] = await Promise.all(
        [doc, next].map((d) => queryEventsNode(generate(d, { only: instrument.id }), 0, 28)),
      );
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();
      expect(a.events.length).toBeGreaterThan(0);
      if (instrument.id === row.id) {
        expect(
          b.events.every((e) => (e.value as Record<string, unknown>)[setting.name] === value),
        ).toBe(true);
        expect(
          b.events
            .map((e) =>
              stable({ ...e, value: { ...(e.value as object), [setting.name]: undefined } }),
            )
            .sort(),
        ).toEqual(
          a.events
            .map((e) =>
              stable({ ...e, value: { ...(e.value as object), [setting.name]: undefined } }),
            )
            .sort(),
        );
      } else expect(b.events.map(stable).sort()).toEqual(a.events.map(stable).sort());
    }
  });

it('one throttled revision carries earlier edits to other targets; late promises cannot regress good', () => {
  const a = load('note(60).gain(.5).pan(.2)'),
    [gain, pan] = settings(a);
  const b = changed(a, gain.id, 0.8),
    c = changed(b, pan.id, 0.7);
  let p = transition(pending(a), {
    type: 'edit',
    doc: b,
    target: gain.id,
    token: 1,
    playing: true,
  });
  p = transition(p, { type: 'edit', doc: c, target: pan.id, token: 2, playing: true });
  p = transition(p, { type: 'sent', token: 2, revision: 3, doc: c });
  p = transition(p, { type: 'swapped', revision: 3 });
  expect(p.entries).toEqual({});
  expect(p.good).toBe(c);
  p = transition(p, { type: 'sent', token: 1, revision: 2, doc: b });
  expect(p.good).toBe(c);
});

it('describes instruments, rhythms, rewrites, sections, signals and patterned settings', () => {
  const doc = load(
    'const bass=note("c2 e2").lpf(450).gain(".1 .8").pan(sine.slow(2)).rev(); arrange([4,bass],[4,bass.lpf(900)])',
  );
  const row = instruments(doc)[0];
  expect(describeTarget(doc, row.id)).toMatchObject({
    kind: 'instrument',
    instrumentId: row.id,
    breadcrumb: ['bass'],
  });
  expect(describeTarget(doc, `${row.pattern.id}:rhythm`)).toMatchObject({
    kind: 'rhythm',
    node: row.pattern,
  });
  expect(settings(doc).map((s) => describeTarget(doc, s.id).kind)).toEqual([
    'setting-constant',
    'setting-values',
    'setting-signal',
    'setting-constant',
  ]);
  const rewrite = row.pattern.layers.find((l) => l.kind === 'rewrite')!;
  expect(describeTarget(doc, rewrite.id).kind).toBe('rewrite');
});
