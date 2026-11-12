import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { checkDoc, instruments, sections, type Doc } from '../src/document';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { removeInstrument } from '../src/document/edits/instrument-remove';
import { setUseMuted } from '../src/document/edits/set-use-muted';
import { copyPattern, sectionOwner, replaceParts } from '../src/document/edits/section-shared';
import { history, push, undo } from '../src/editor/history';
import { queryEventsNode } from './node-query';
const load = (source: string) => importStrudel(source).doc;
const accept = (next: Doc | { ok: false; reason: string }): Doc => {
  if ('ok' in next) throw Error(next.reason);
  return next;
};
it('refuses the last instrument and stale targets with an actionable reason', () => {
  const doc = load('s("bd")');
  expect(removeInstrument(doc, instruments(doc)[0].id)).toMatchObject({
    ok: false,
    reason: expect.stringMatching(/only instrument.*[Aa]dd/),
  });
  expect(removeInstrument(doc, 'missing')).toMatchObject({ ok: false });
});
it('keeps silent sections, timing slots and exact undo; removes empty stacks and aliases', async () => {
  const doc = load(
    'const drum=s("bd"); const alias=drum; const intro=stack(alias); arrange([3,intro],[2,s("hh")])',
  );
  const next = accept(removeInstrument(doc, instruments(doc)[0].id));
  expect(checkDoc(next)).toEqual([]);
  expect(sections(next).map(({ name, start, cycles }) => ({ name, start, cycles }))).toEqual(
    sections(doc).map(({ name, start, cycles }) => ({ name, start, cycles })),
  );
  expect(sections(next)[0].instrumentIds).toEqual([]);
  expect(generate(next)).not.toMatch(/const (drum|alias|intro) =|stack\(\)/);
  expect(undo(push(history(doc), next, 'document')).present).toEqual(doc);
  const result = await queryEventsNode(generate(next), 0, 5);
  expect(result.error).toBeNull();
  expect(result.events.map((e) => e.part[0])).toEqual([3, 4]);
  for (const how of ['cat', 'seq']) {
    const timed = load(`${how}(s("bd"),s("hh"))`);
    const other = instruments(timed)[1];
    const edited = accept(removeInstrument(timed, instruments(timed)[0].id));
    expect(await queryEventsNode(generate(edited, { only: other.id }), 0, 4)).toEqual(
      await queryEventsNode(generate(timed, { only: other.id }), 0, 4),
    );
  }
});
it('removes localized origins and every repeated section use', () => {
  const doc = load(
    'const drum=s("bd"); const drop=stack(drum,s("hh")); arrange([2,drop],[2,drop])',
  );
  const row = instruments(doc)[0];
  const local = accept(setUseMuted(doc, row.id, sections(doc)[0].id, true));
  const next = accept(removeInstrument(local, row.id));
  expect(checkDoc(next)).toEqual([]);
  expect(instruments(next)).toHaveLength(1);
  expect(generate(next)).not.toContain("'bd'");
});
it('names the dependent instrument when a shared score is also its setting or source', () => {
  for (const source of [
    'const drum=s("bd"); const hat=s("hh").gain(drum); stack(drum,hat)',
    'const drum=s("bd"); const hat=s("hh").off(0.5,p=>p.gain(drum)); stack(drum,hat)',
  ]) {
    const doc = load(source);
    expect(
      removeInstrument(doc, instruments(doc).find((r) => r.name === 'drum')!.id),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/hat.*(setting|source|depends)/),
    });
  }
});
for (const file of ['piece-kiln', 'real-house-arranged'])
  it(`${file}: delete each row without changing any other onset over the whole song; round trip`, async () => {
    const doc = load(readFileSync(`corpus/programs/${file}.strudel`, 'utf8'));
    const original = structuredClone(doc),
      rows = instruments(doc);
    const end = sections(doc).reduce((n, s) => n + s.cycles, 0);
    const onsets = (r: Awaited<ReturnType<typeof queryEventsNode>>) => {
      expect(r.error).toBeNull();
      return r.events.filter((e) => e.hasOnset);
    };
    const baseline = await Promise.all(
      rows.map((r) => queryEventsNode(generate(doc, { only: r.id }), 0, end)),
    );
    for (const removed of rows) {
      const next = accept(removeInstrument(doc, removed.id));
      expect(checkDoc(next)).toEqual([]);
      expect(instruments(next).map((r) => r.id)).toEqual(
        rows.filter((r) => r !== removed).map((r) => r.id),
      );
      expect(sections(next).map((s) => [s.start, s.cycles])).toEqual(
        sections(doc).map((s) => [s.start, s.cycles]),
      );
      for (const [index, row] of rows.entries()) {
        if (row === removed) continue;
        expect(onsets(await queryEventsNode(generate(next, { only: row.id }), 0, end))).toEqual(
          onsets(baseline[index]),
        );
      }
      const round = load(generate(next));
      expect(onsets(await queryEventsNode(generate(round), 0, end))).toEqual(
        onsets(await queryEventsNode(generate(next), 0, end)),
      );
    }
    expect(doc).toEqual(original);
  });

it('refuses whole-pattern rewrites on a shared ancestor, including callback bodies', () => {
  for (const suffix of ['.arp("up")', '.every(2,p=>p.arp("up"))']) {
    const doc = load(
      `const drum=s("bd"); const hat=s("hh"); const band=stack(drum,hat); band${suffix}`,
    );
    expect(removeInstrument(doc, instruments(doc)[0].id)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/hat.*arp/),
    });
  }
});
it('refuses references hidden in opaque source and leaves standalone neighbours intact', async () => {
  const dependent = load('const drum=s("bd"); const hat=s("hh").gain(()=>drum); stack(drum,hat)');
  expect(removeInstrument(dependent, instruments(dependent)[0].id)).toMatchObject({
    ok: false,
    reason: expect.stringContaining('hat'),
  });
  const doc = load('drum: s("bd"); hat: s("hh")');
  const rows = instruments(doc),
    next = accept(removeInstrument(doc, rows[0].id));
  expect(instruments(next).map((r) => r.id)).toEqual([rows[1].id]);
  expect(await queryEventsNode(generate(next), 0, 2)).toEqual(
    await queryEventsNode(generate(doc, { only: rows[1].id }), 0, 2),
  );
});

it('deletes stored origin copies together with their canonical leaf', () => {
  const doc = load(
    'const drum=s("bd"); const drop=stack(drum,s("hh")); arrange([2,drop],[2,drop])',
  );
  const row = instruments(doc)[1];
  const owner = sectionOwner(doc, sections(doc)[0].id)!;
  const local = replaceParts(
    doc,
    owner.root,
    owner.parts.map((part, i) =>
      i === 0 ? { ...part, pattern: copyPattern(doc, owner.content) } : part,
    ),
  );
  expect(JSON.stringify(local)).toContain(`"origin":"${row.pattern.id}"`);
  expect(checkDoc(local)).toEqual([]);
  const next = accept(removeInstrument(local, row.id));
  expect(checkDoc(next)).toEqual([]);
  expect(instruments(next)).toHaveLength(1);
  expect(JSON.stringify(next)).not.toContain(`"origin":"${row.pattern.id}"`);
  expect(generate(next)).not.toContain("'hh'");
});

it('refuses a shared callback that uses the whole score as a setting driver', () => {
  const doc = load('const drum=s("bd"); const hat=s("hh"); stack(drum,hat).every(2,p=>p.gain(p))');
  expect(removeInstrument(doc, instruments(doc)[0].id)).toMatchObject({
    ok: false,
    reason: expect.stringContaining('hat'),
  });
});
