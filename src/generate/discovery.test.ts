import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { discoveryIdentity } from './discovery';
import { generate } from './index';
import { importStrudel } from '../import';
import { walk, type Doc, type Setting } from '../document';
import { setConstant } from '../document/edits/set-constant';
import { replaceFromSource } from '../document/edits/source-node';
import { queryEvents, queryEventsWithBudget } from '../strudel/evaluate';

const kiln = importStrudel(readFileSync('corpus/programs/piece-kiln.strudel', 'utf8')).doc;
function cutoff(doc: Doc) {
  let id = '';
  walk(doc, (n) => {
    if ('name' in n && n.name === 'cutoff') id = n.id;
  });
  return id;
}

test('Kiln constant cutoff/gain admission keeps real starts, pitch and section inventory', async () => {
  const next = setConstant(kiln, cutoff(kiln), 900);
  if ('ok' in next) throw Error(next.reason);
  const identity = discoveryIdentity(kiln);
  expect(identity).toBeDefined();
  expect(discoveryIdentity(next)).toBe(identity);
  expect(generate(next)).not.toBe(generate(kiln));
  const original = JSON.stringify(kiln);
  const gain = structuredClone(kiln);
  walk(gain, (n) => {
    if ('name' in n && n.name === 'gain')
      (n as Setting).value.core = { kind: 'constant', value: 0 };
  });
  expect(discoveryIdentity(gain)).toBe(identity);
  const answers = await Promise.all([kiln, next, gain].map((d) => queryEvents(generate(d), 0, 32)));
  expect(answers.every((a) => !a.error && !a.opaqueValues)).toBe(true);
  const inventory = (a: (typeof answers)[number]) =>
    a.events
      .filter((e) => e.hasOnset)
      .map((e) => {
        const { cutoff: _cutoff, gain: _gain, ...asset } = e.value as Record<string, unknown>;
        void _cutoff;
        void _gain;
        return { whole: e.whole, asset };
      });
  expect(inventory(answers[1])).toEqual(inventory(answers[0]));
  expect(inventory(answers[2])).toEqual(inventory(answers[0]));
  expect(answers[1].events.some((e) => (e.value as { cutoff?: number }).cutoff === 900)).toBe(true);
  expect(JSON.stringify(kiln)).toBe(original);
});

for (const suffix of ['.n(1)', '.note(72)', '.bank("other")', '.s("other")', '.slow(2)'])
  test(`asset/timing selector is retained: ${suffix}`, () => {
    const doc = importStrudel(`s("sine").gain(.4)${suffix}`).doc;
    expect(discoveryIdentity(doc)).toBeDefined();
    expect(discoveryIdentity(doc)).not.toBe(
      discoveryIdentity(importStrudel('s("sine").gain(.4)').doc),
    );
  });

for (const source of [
  'samples({late:["/late.wav"]}); s("late").gain(.4)',
  'register("custom", (x,p)=>p); s("sine").custom(2)',
  'globalThis.count++; s("sine")',
  's("sine").gain(slider(.4))',
  's("sine").gain(sine)',
  's("sine").every(2,p=>p.gain(.5))',
  's("sine").custom(2)',
  'custom().gain(.4)',
  'const a=s("sine").gain(.4); s(a)',
  'const a=s("sine").gain(.4); s("sine").add(a)',
  'new Pattern(state => [])',
  's("^external").gain(.4)',
])
  test(`unproven programs always fall back: ${source}`, () => {
    expect(discoveryIdentity(importStrudel(source).doc)).toBeUndefined();
  });

test('section lengths, mute, IDs/names and source replacements invalidate', () => {
  const key = discoveryIdentity(kiln);
  for (const change of [
    (d: Doc) => {
      walk(d, (n) => {
        if ('cycles' in n) n.cycles = 5;
      });
    },
    (d: Doc) => {
      const n = d.body.find((n) => n.kind === 'voice')!;
      n.muted = true;
    },
    (d: Doc) => {
      d.body[0].id += 'new';
    },
    (d: Doc) => {
      const n = d.body.find((n) => n.kind === 'shared')!;
      n.name += 'renamed';
    },
  ]) {
    const changed = structuredClone(kiln);
    change(changed);
    expect(discoveryIdentity(changed)).not.toBe(key);
  }
  const source = replaceFromSource(kiln, cutoff(kiln), '.lpf(900)');
  if ('ok' in source) throw Error(source.reason);
  expect(discoveryIdentity(source)).not.toBe(key);
});

test('pinned preflight separates extra inventory from current-window values without dropping either', async () => {
  const source = 'arrange([40,s("sine")],[2,s("late")])';
  const full = await queryEventsWithBudget(source, 0, 16, undefined, [40]);
  expect(full.error).toBeNull();
  expect(full.discoveryValues).toHaveLength(3);
  expect(full.discoveryValues!.every((v) => (v as { s: string }).s === 'late')).toBe(true);
  expect(full.events.some((e) => (e.value as { s: string }).s === 'sine')).toBe(true);
  const current = await queryEventsWithBudget(source, 0, 16, undefined, []);
  expect(current.error).toBeNull();
  expect(current.discoveryValues).toEqual([]);
  expect(current.events.every((e) => (e.value as { s: string }).s === 'sine')).toBe(true);
});

test('loaded JSON cannot introduce executable names or unproven timing through admission', () => {
  const badName = structuredClone(kiln);
  const shared = badName.body.find((n) => n.kind === 'shared')!;
  shared.name = 'injected = globalThis.effect++; const next';
  expect(discoveryIdentity(badName)).toBeUndefined();
  const badTempo = structuredClone(kiln);
  const tempo = badTempo.body[0];
  if (tempo.kind !== 'tempo') throw Error('Expected tempo');
  tempo.cpm = 'globalThis.effect++' as unknown as number;
  expect(discoveryIdentity(badTempo)).toBeUndefined();
});
