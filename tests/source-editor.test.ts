import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { checkDoc, instruments, walk, type Doc, type Setting } from '../src/document';
import { describeTarget } from '../src/document/edit';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { replaceOpaque } from '../src/document/edits/source-opaque';
import { prepareSource, replaceFromSource } from '../src/document/edits/source-node';
import { sourceFragment, sameOnsets } from '../src/document/edits/source-shared';
import { setGenericArgument } from '../src/document/edits/generic-argument';
import { queryEventsNode } from './node-query';
const load = (s: string) => importStrudel(s).doc;
const accepted = (result: ReturnType<typeof replaceFromSource>) => {
  if ('ok' in result) throw Error(result.reason);
  expect(checkDoc(result)).toEqual([]);
  return result;
};
function settings(doc: Doc) {
  const result: Setting[] = [];
  walk(doc, (n) => {
    if ('value' in n && 'name' in n) result.push(n as Setting);
  });
  return result;
}
it('imports a setting in place, keeps its selection and untouched branches, refuses broken text', () => {
  const doc = load('const bass=note(60).lpf(450).gain(.5); stack(bass,s("hh"))');
  const cutoff = settings(doc)[0];
  expect(sourceFragment(doc, `${cutoff.id}:source`)).toBe('.cutoff(450)');
  const next = accepted(replaceFromSource(doc, `${cutoff.id}:source`, '.lpf(900)'));
  expect(describeTarget(next, cutoff.id).value).toBe(900);
  expect(next.body[1]).toBe(doc.body[1]);
  expect(settings(next)[1]).toBe(settings(doc)[1]);
  expect(describeTarget(doc, cutoff.id).value).toBe(450);
  expect(replaceFromSource(doc, cutoff.id, '.lpf(')).toMatchObject({ ok: false });
  expect(replaceFromSource(doc, 'missing', '1')).toMatchObject({ ok: false });
});
it('retains opaque text verbatim, promotes understood calls and addresses opaque arguments', () => {
  const doc = load('note(60).withValue(v=>v).gain(.5)');
  const row = instruments(doc)[0],
    layer = row.pattern.layers[0];
  const raw = accepted(replaceOpaque(doc, layer.id, '.gain(0.25)'));
  expect(generate(raw)).toContain('.gain(0.25)');
  const next = accepted(replaceFromSource(doc, layer.id, '.gain(0.25)'));
  expect(settings(next)[0].value.core).toEqual({ kind: 'constant', value: 0.25 });
  const argId = `${layer.id}:arg:0`;
  expect(describeTarget(doc, argId).kind).toBe('source');
  expect(sourceFragment(doc, argId)).toBe('v => v');
  expect(generate(accepted(replaceOpaque(doc, argId, 'v => ({...v, gain: .2})')))).toContain(
    'v => ({...v, gain: .2})',
  );
});
it('generic arguments preserve type, parse mini notation and refuse missing or callback edits', () => {
  const doc = load('note(60).chop(8).struct("x ~ x").off(.1,p=>p.rev())');
  const [chop, struct, off] = instruments(doc)[0].pattern.layers;
  const next = accepted(setGenericArgument(doc, chop.id, 0, '16'));
  expect(generate(next)).toContain('.chop(16)');
  expect(next.body).not.toBe(doc.body);
  expect(instruments(next)[0].pattern.layers[1]).toBe(struct);
  expect(setGenericArgument(doc, chop.id, 0, 'NaN')).toMatchObject({ ok: false });
  expect(setGenericArgument(doc, chop.id, 9, '2')).toMatchObject({ ok: false });
  expect(setGenericArgument(doc, 'missing', 0, '2')).toMatchObject({ ok: false });
  expect(setGenericArgument(doc, off.id, 1, 'p=>p.fast(2)')).toMatchObject({ ok: false });
  expect(setGenericArgument(doc, struct.id, 0, '[')).toMatchObject({ ok: false });
  expect(generate(accepted(setGenericArgument(doc, struct.id, 0, 'x x')))).toContain('"x x"');
});
it('real house source setting stays understood and changes bass onsets only', async () => {
  const doc = load(readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'));
  const bass = instruments(doc).find((r) => r.name === 'bass')!;
  const cutoff = settings(doc).find(
    (s) => s.name === 'cutoff' && describeTarget(doc, s.id).instrumentId === bass.id,
  )!;
  const next = accepted(replaceFromSource(doc, `${cutoff.id}:source`, '.lpf(900)'));
  expect(describeTarget(next, cutoff.id).value).toBe(900);
  for (const row of instruments(doc)) {
    const a = await queryEventsNode(generate(doc, { only: row.id }), 8, 16);
    const b = await queryEventsNode(generate(next, { only: row.id }), 8, 16);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    if (row.id === bass.id) {
      expect(sameOnsets(a, b)).toBe(false);
      expect(
        b.events
          .filter((e) => e.hasOnset)
          .every((e) => (e.value as { cutoff: number }).cutoff === 900),
      ).toBe(true);
    } else expect(sameOnsets(a, b)).toBe(true);
  }
});
it('real custom samples: tier 3 setup and tier 2 slice survive valid editing and parse refusal', async () => {
  const doc = load(readFileSync('corpus/programs/real-custom-samples.strudel', 'utf8'));
  expect(doc.body[0]).toMatchObject({ kind: 'setup', tier: 3 });
  const row = instruments(doc)[0];
  expect(row.pattern.layers.some((l) => l.tier === 2 && 'name' in l && l.name === 'slice')).toBe(
    true,
  );
  const text = "samples({myvocal: 'https://your-url.com'}); all(p => p.gain(.2));";
  const next = accepted(replaceOpaque(doc, doc.body[0].id, text));
  expect(generate(next)).toContain(text);
  expect(next.body[1]).toBe(doc.body[1]);
  expect(replaceOpaque(doc, doc.body[0].id, 'samples({')).toMatchObject({ ok: false });
  const setupBefore = await queryEventsNode(generate(doc), 0, 4);
  const setupAfter = await queryEventsNode(generate(next), 0, 4);
  expect(setupBefore.error).toBeNull();
  expect(setupAfter.error).toBeNull();
  expect(sameOnsets(setupBefore, setupAfter)).toBe(false);
  const before = JSON.stringify(doc);
  const slice = row.pattern.layers.find((l) => 'name' in l && l.name === 'slice')!;
  const edited = accepted(setGenericArgument(doc, slice.id, 0, '4'));
  const a = await queryEventsNode(generate(doc), 0, 4),
    b = await queryEventsNode(generate(edited), 0, 4);
  expect(a.error).toBeNull();
  expect(b.error).toBeNull();
  expect(sameOnsets(a, b)).toBe(false);
  expect(JSON.stringify(doc)).toBe(before);
});
it('core source is exact, retains outside layers and imports rewrites without dropping them', () => {
  const doc = load('note(60).gain(.5)');
  const p = instruments(doc)[0].pattern;
  const next = accepted(replaceFromSource(doc, `${p.id}:rhythm`, 'note(62).fast(2)'));
  expect(generate(next)).toContain('.fast(2)');
  expect(generate(next)).toContain('.gain(0.5)');
  const opaque = load('(true ? note(60) : silence).gain(.5)');
  const row = instruments(opaque)[0];
  expect(sourceFragment(opaque, `${row.pattern.id}:source`)).toBe('true ? note(60) : silence');
});
it('splits setting bags without duplicate ids or changing values in structured data', () => {
  const doc = load('note(60).gain(.5).lpf(450).pan(.2)');
  const target = settings(doc)[1];
  accepted(replaceFromSource(doc, target.id, '.fast(2)'));
  const p = instruments(doc)[0].pattern;
  const next = accepted(
    replaceFromSource(doc, `${p.id}:source`, "pure({id:'keep',tier:1,note:62})"),
  );
  expect(generate(next)).toContain("'id': 'keep'");
});
it('promotion is gated on whole onset multisets, with opaque source kept on failures or mismatches', async () => {
  const doc = load('note(60).gain(.5)'),
    id = settings(doc)[0].id;
  const a = await queryEventsNode(generate(doc), 0, 4);
  const same = {
    ...a,
    events: [...a.events].reverse().map((e) => ({ ...e, part: [0, 100] as [number, number] })),
  };
  expect(sameOnsets(a, same)).toBe(true);
  const success = await prepareSource(doc, id, '.gain(.2)', async (d) =>
    queryEventsNode(generate(d), 0, 4),
  );
  if ('ok' in success) throw Error(success.reason);
  expect(success.promoted).toBe(true);
  expect(describeTarget(success.doc, id).value).toBe(0.2);
  const refusal = await prepareSource(doc, id, '.gain(');
  expect(refusal).toMatchObject({ ok: false });
  for (const ask of [
    undefined,
    async () => ({ ...a, opaqueValues: true }),
    async () => ({ ...a, error: { phase: 'timeout' as const, message: 'Question timed out' } }),
    async () => {
      throw Error('Stopped query');
    },
  ]) {
    const result = await prepareSource(doc, id, '.gain(.2)', ask);
    if ('ok' in result) throw Error(result.reason);
    expect(result.promoted).toBe(false);
    expect(generate(result.doc)).toContain('.gain(.2)');
  }
  let serial = 0;
  const mismatch = await prepareSource(doc, id, '.gain(.2)', async () =>
    serial++ ? { ...a, events: [] } : a,
  );
  expect(mismatch).toMatchObject({ promoted: false });
});
it('source operations cover top level, arguments, scoped callbacks and all parse refusals immutably', () => {
  const doc = load(
    'setcpm(30); const values=note(60); values.off(.1,q=>q.fast(2)).withValue(v=>({...v}));',
  );
  const before = JSON.stringify(doc),
    row = instruments(doc)[0];
  for (const operation of [replaceOpaque, replaceFromSource]) {
    expect(operation(doc, 'missing', '1')).toMatchObject({ ok: false });
    expect(operation(doc, row.id, ' ')).toMatchObject({ ok: false });
    expect(operation(doc, doc.body[0].id, 'setcpm(')).toMatchObject({ ok: false });
    const next = accepted(operation(doc, doc.body[0].id, 'setcpm(40);'));
    expect(next.body[1]).toBe(doc.body[1]);
    expect(generate(next)).toContain('setcpm(40);');
  }
  const voice = doc.body.at(-1)!;
  if (voice.kind !== 'voice') throw Error('Missing voice');
  const [off, opaque] = voice.pattern.layers;
  if (off.kind !== 'rewrite' || off.args[1].kind !== 'callback') throw Error('Missing callback');
  const edited = accepted(replaceFromSource(doc, off.args[1].body.layers[0].id, '.fast(3)'));
  expect(generate(edited)).toContain('q => q.fast(3)');
  expect(replaceOpaque(doc, off.id, 'note(62)')).toMatchObject({ ok: false });
  expect(replaceOpaque(doc, `${opaque.id}:arg:5`, 'v=>v')).toMatchObject({ ok: false });
  const arg = accepted(setGenericArgument(doc, opaque.id, 0, 'v => ({...v, gain: .2})'));
  expect(generate(arg)).toContain('v => ({...v, gain: .2})');
  expect(setGenericArgument(doc, off.id, 0, '')).toMatchObject({ ok: false });
  expect(JSON.stringify(doc)).toBe(before);
});
