import { expect, it } from 'vitest';
import { instruments, voices } from '../document';
import { importStrudel } from '../import';
import { queryEvents } from '../strudel/evaluate';
import { generate } from './index';

it('isolates shared instruments through section layers and keeps globals and timing', async () => {
  const doc = importStrudel(
    'setcpm(90); const chords=note(60).s("piano"); const intro=stack(chords.lpf(600),s("hh")); $: arrange([4,intro],[8,s("bd")],[4,chords.room(.8)]); all(p=>p.slow(2))',
  ).doc;
  const selected = instruments(doc).find((i) => i.name === 'chords')!;
  const whole = await queryEvents(generate(doc), 0, 32);
  const only = await queryEvents(generate(doc, { only: selected.id }), 0, 32);
  expect(only.error).toBeNull();
  expect(only.cps).toBe(1.5);
  expect(only.events).toEqual(whole.events.filter((e) => (e.value as { s: string }).s === 'piano'));
  expect(only.events.some((e) => e.part[0] >= 24)).toBe(true);
  expect(generate(doc, { only: voices(doc)[0].id })).toBe(generate(doc));
  expect(() => generate(doc, { only: 'missing' })).toThrow('Unknown instrument');
});
it('does not mute a shared pattern used as an argument or setting driver', async () => {
  const doc = importStrudel('const value=pure(60); stack(value, note(value).s("piano"))').doc;
  const row = instruments(doc).find(
    (i) => i.pattern.core.kind === 'generator' && i.pattern.core.name === 'note',
  )!;
  const result = await queryEvents(generate(doc, { only: row.id }), 0, 1);
  expect(result.error).toBeNull();
  expect(result.events).toHaveLength(1);
  expect(result.events[0].value).toEqual({ note: 60, s: 'piano' });
});
it.each([
  'stack(s("bd"),s("hh")).superimpose(()=>s("cp"))',
  '$: stack(s("bd"),s("hh")); all(p=>stack(p,s("cp")))',
])('states the partition limit for a transform adding independent events: %s', async (source) => {
  const doc = importStrudel(source).doc;
  const whole = await queryEvents(generate(doc), 0, 1);
  const results = [];
  for (const row of instruments(doc))
    results.push(await queryEvents(generate(doc, { only: row.id }), 0, 1));
  expect(whole.error).toBeNull();
  expect(results.every((r) => r.error === null)).toBe(true);
  // Keeping a group/global rewrite preserves its independent clap in each query.
  // Such transforms do not distribute: an exact instrument partition is undefined.
  expect(whole.events).toHaveLength(3);
  expect(results.flatMap((r) => r.events)).toHaveLength(4);
});
it('isolates every use of a shared leaf across standalone voices while voice ids still work', async () => {
  const doc = importStrudel('const kick=s("bd"); $: kick; $: kick.fast(2); $: s("hh")').doc;
  const row = instruments(doc).find((i) => i.name === 'kick')!;
  const only = await queryEvents(generate(doc, { only: row.id }), 0, 1);
  expect(only.error).toBeNull();
  expect(only.events).toHaveLength(3);
  expect(only.events.every((e) => (e.value as { s: string }).s === 'bd')).toBe(true);
  expect((await queryEvents(generate(doc, { only: voices(doc)[0].id }), 0, 1)).events).toHaveLength(
    1,
  );
});
