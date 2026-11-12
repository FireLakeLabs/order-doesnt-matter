import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  checkDoc,
  describeTarget,
  instruments,
  sections,
  voices,
  walk,
  type Doc,
} from '../src/document';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { renameInstrument } from '../src/document/edits/rename-instrument';
import { setUseMuted } from '../src/document/edits/set-use-muted';
import { setInstrumentInSection } from '../src/document/edits/section-instrument';
import { renameSection } from '../src/document/edits/section-rename';
import { separateSection } from '../src/document/edits/section-separate';
import { removeSection } from '../src/document/edits/section-remove';
import { sheetModel } from '../src/sheet/model';
import { queryEventsNode } from './node-query';
const load = (s: string) => importStrudel(s).doc;
const accept = (d: Doc | { ok: false; reason: string }): Doc => {
  if ('ok' in d) throw Error(d.reason);
  expect(checkDoc(d)).toEqual([]);
  return d;
};
const real = () => load(readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'));
it('v2 gives every group occurrence a distinct address, independent of its pattern', () => {
  const doc = load('const a=s("bd"); arrange([2,a],[2,a])');
  expect(doc.version).toBe(2);
  const root = voices(doc)[0].pattern;
  if (root.core.kind !== 'group') throw Error('group');
  expect(sections(doc).map((s) => s.id)).toEqual(root.core.parts.map((p) => p.id));
  expect(root.core.parts.every((p) => p.id && p.id !== p.pattern.id)).toBe(true);
  expect(describeTarget(doc, sections(doc)[1].id).kind).toBe('section');
  root.core.parts[1].id = root.core.parts[0].id;
  expect(checkDoc(doc)).toContain(`Duplicate id: ${root.core.parts[0].id}`);
});
it('purpose inventories unused instruments and excludes section/value definitions', () => {
  const doc = load(
    'const unused=s("bd"); const section=stack(s("hh")); const value=note(60); silence',
  );
  for (const n of doc.body)
    if (n.kind === 'shared')
      n.purpose = n.name === 'unused' ? 'instrument' : n.name === 'section' ? 'section' : 'value';
  expect(instruments(doc).map((r) => r.name)).toEqual(['unused']);
  expect(instruments(doc)[0].uses).toEqual([]);
  expect(instruments(load(generate(doc))).map((r) => r.name)).toEqual(['unused']);
  const row = sheetModel({ doc, events: {}, sounds: [], fromCycle: 0, toCycle: 4, playhead: null })
    .rows[0];
  expect(row.status).toBe('plays in no section');
  expect(describeTarget(doc, row.id).kind).toBe('instrument');
});
it('inline promotion retains the canonical leaf id and allocates a fresh reference id', () => {
  const doc = load('arrange([2,s("bd")],[2,s("hh")])'),
    row = instruments(doc)[0],
    ids = sections(doc).map((s) => s.id);
  const next = accept(renameInstrument(doc, row.id, 'Drum'));
  expect(instruments(next)[0]).toMatchObject({ id: row.id, name: 'Drum', nameSource: 'author' });
  const definition = next.body.find((n) => n.kind === 'shared' && n.pattern.id === row.pattern.id);
  expect(definition).toMatchObject({ kind: 'shared', nameSource: 'author', purpose: 'instrument' });
  expect(sections(next).map((s) => s.id)).toEqual(ids);
  expect(voices(next)[0].pattern.core).toMatchObject({
    kind: 'group',
    parts: [
      {
        pattern: {
          core: { kind: 'ref' },
          id: expect.not.stringMatching(new RegExp(`^${row.id}$`)),
        },
      },
      {},
    ],
  });
  expect(instruments(load(generate(next)))[0]).toMatchObject({
    name: 'Drum',
    nameSource: 'author',
  });
});
it('origin joins a localized copy to its definition, validates the target, and round trips', () => {
  const doc = load('const drum=s("bd"); arrange([2,drum],[2,s("hh")])');
  const definition = doc.body[0];
  if (definition.kind !== 'shared') throw Error('shared');
  definition.purpose = 'instrument';
  const root = voices(doc)[0].pattern;
  if (root.core.kind !== 'group') throw Error('group');
  const local = structuredClone(definition.pattern);
  const remap = new Map<string, string>();
  walk({ version: 2, body: [{ ...definition, pattern: local }] }, (n) => {
    remap.set(n.id, `copy-${n.id}`);
    n.id = `copy-${n.id}`;
  });
  local.origin = definition.pattern.id;
  root.core.parts[1].pattern = local;
  expect(checkDoc(doc)).toEqual([]);
  expect(instruments(doc)).toHaveLength(1);
  expect(instruments(doc)[0].uses).toHaveLength(2);
  const round = load(generate(doc));
  expect(checkDoc(round)).toEqual([]);
  expect(instruments(round)).toHaveLength(1);
  expect(instruments(round)[0].uses).toHaveLength(2);
  local.origin = 'missing';
  expect(checkDoc(doc).join(' ')).toContain('origin');
  local.origin = root.id;
  expect(checkDoc(doc).join(' ')).toContain('origin');
});
it('real house: section names/provenance survive generation and separation keeps occurrence ids', () => {
  const doc = real(),
    part = sections(doc)[2];
  const next = accept(renameSection(doc, part.id, 'Main room'));
  expect(sections(load(generate(next))).filter((s) => s.name === 'Main room')).toHaveLength(2);
  expect(sections(load(generate(next)))[2].nameSource).toBe('author');
  const separate = accept(separateSection(next, part.id));
  expect(sections(separate).map((s) => s.id)).toEqual(sections(doc).map((s) => s.id));
  expect(sections(load(generate(separate)))[2].nameSource).toBe('generated');
  expect(generate(separate)).not.toContain('__odm_section_');
});
it('real house: chords mute in one shared drop keeps one row and only removes that occurrence’s note starts', async () => {
  const doc = real(),
    rows = instruments(doc),
    chords = rows.find((r) => r.name === 'chords')!,
    drop = sections(doc)[2];
  const next = accept(setUseMuted(doc, chords.id, drop.id, true));
  expect(instruments(next).map((r) => r.id)).toEqual(rows.map((r) => r.id));
  expect(instruments(next).filter((r) => r.name === 'chords')).toHaveLength(1);
  expect(
    instruments(next)
      .find((r) => r.id === chords.id)!
      .uses.some((u) => u.path.some((p) => 'core' in p && p.core.kind === 'ref')),
  ).toBe(true);
  const notes = (r: Awaited<ReturnType<typeof queryEventsNode>>) => {
    expect(r.error).toBeNull();
    return r.events
      .filter((e) => e.hasOnset)
      .map((e) => JSON.stringify([e.whole, e.value]))
      .sort();
  };
  const combined: string[] = [];
  for (const row of rows) {
    const [before, after] = await Promise.all(
      [doc, next].map((d) => queryEventsNode(generate(d, { only: row.id }), 0, 28)),
    );
    expect(notes(after)).toEqual(
      notes({
        ...before,
        events: before.events.filter(
          (e) =>
            row.id !== chords.id || e.part[0] < drop.start || e.part[0] >= drop.start + drop.cycles,
        ),
      }),
    );
    combined.push(...notes(after));
  }
  expect(combined.sort()).toEqual(notes(await queryEventsNode(generate(next), 0, 28)));
  const round = load(generate(next));
  expect(instruments(round).map((r) => r.name)).toEqual(rows.map((r) => r.name));
  expect(notes(await queryEventsNode(generate(round), 0, 28))).toEqual(combined.sort());
});
it('real house: removing kick from every section retains its definition, row and editor', () => {
  const doc = real(),
    kick = instruments(doc).find((r) => r.name === 'kick')!;
  let next = doc;
  for (const s of sections(doc)) next = accept(setInstrumentInSection(next, s.id, kick.id, false));
  expect(sections(next).every((s) => !s.instrumentIds.includes(kick.id))).toBe(true);
  expect(instruments(next).find((r) => r.id === kick.id)).toBeDefined();
  expect(describeTarget(next, kick.id).kind).toBe('instrument');
  const model = sheetModel({
    doc: next,
    events: {},
    sounds: [],
    fromCycle: 0,
    toCycle: 4,
    playhead: null,
  });
  expect(model.rows.find((r) => r.id === kick.id)?.status).toBe('plays in no section');
  const round = load(generate(next));
  expect(instruments(round).find((r) => r.name === 'kick')).toBeDefined();
  // Removing the last occurrence altogether preserves the inventory too.
  const tiny = load('const kick=s("bd"); const hat=s("hh"); arrange([2,kick],[2,hat])');
  const removed = accept(removeSection(tiny, sections(tiny)[0].id));
  expect(instruments(removed).map((r) => r.name)).toEqual(['hat', 'kick']);
});

it('standalone naming transfers the leaf into inventory while retaining its row identity', () => {
  const doc = load('s("bd")'),
    row = instruments(doc)[0];
  const named = accept(renameInstrument(doc, row.id, 'Drum'));
  expect(instruments(named)[0].id).toBe(row.id);
  expect(named.body.find((n) => n.kind === 'shared')).toMatchObject({
    purpose: 'instrument',
    pattern: { id: row.pattern.id },
  });
});
it('a definition mute also silences local variations, survives import, and can be undone without losing local membership', async () => {
  const { setMuted } = await import('../src/document/edits/set-muted');
  const doc = load(
      'const drum=s("bd"); const drop=stack(drum,s("hh")); arrange([2,drop],[2,drop])',
    ),
    row = instruments(doc)[0];
  const local = accept(setUseMuted(doc, row.id, sections(doc)[0].id, true));
  const secondMuted = accept(setUseMuted(local, row.id, sections(local)[1].id, true));
  const activeLocal = accept(setUseMuted(secondMuted, row.id, sections(local)[1].id, false));
  const muted = accept(setMuted(activeLocal, row.id, true));
  expect((await queryEventsNode(generate(muted, { only: row.id }), 0, 4)).events).toEqual([]);
  const round = load(generate(muted)),
    roundRow = instruments(round).find((r) => r.name === 'drum')!;
  const restored = accept(setMuted(round, roundRow.id, false));
  expect(
    (await queryEventsNode(generate(restored, { only: roundRow.id }), 0, 4)).events.map(
      (e) => e.part[0],
    ),
  ).toEqual([2, 3]);
  const allLocal = accept(setUseMuted(local, row.id, sections(local)[1].id, false));
  expect(
    instruments(allLocal)
      .find((r) => r.id === row.id)
      ?.uses.map((u) => u.muted),
  ).toEqual([true, false]);
});
it('purpose-less documents retain the old derived inventory and standalone ids', () => {
  const doc = load('const drum=s("bd"); drum');
  for (const n of doc.body) if (n.kind === 'shared') delete n.purpose;
  expect(instruments(doc)[0].id).toBe(voices(doc)[0].id);
  expect(instruments({ ...doc, body: doc.body.filter((n) => n.kind === 'shared') })).toEqual([]);
});
it('part identity is independent even when two occurrences hold the same pattern object', () => {
  const doc = load('const drum=s("bd"); arrange([2,drum],[2,drum])'),
    root = voices(doc)[0].pattern;
  if (root.core.kind !== 'group') throw Error('group');
  const [a, b] = root.core.parts;
  b.pattern = a.pattern;
  // Shared object aliases are not valid JSON storage, but selection must still address the part.
  expect(describeTarget(doc, b.id).section?.id).toBe(b.id);
  expect(describeTarget(doc, a.id).section?.id).toBe(a.id);
});
it('subsequent local edits retain all occurrence and pattern ids', () => {
  const doc = load(
      'const drum=s("bd"); const drop=stack(drum,s("hh")); arrange([2,drop],[2,drop])',
    ),
    row = instruments(doc)[0],
    part = sections(doc)[0];
  const muted = accept(setUseMuted(doc, row.id, part.id, true));
  const restored = accept(setUseMuted(muted, row.id, part.id, false));
  const ids = (d: Doc) => {
    const ids: string[] = [];
    walk(d, (n) => ids.push(n.id));
    return ids;
  };
  expect(ids(restored)).toEqual(ids(muted));
  expect(instruments(restored)[0].uses.map((u) => u.muted)).toEqual([false, false]);
});
it('explicit instrument inventory owns its whole pattern, including groups, without duplicating child inventory events', async () => {
  const doc = load('const drum=s("bd"); const band=stack(drum,s("hh")); arrange([2,band])');
  const band = doc.body.find((n) => n.kind === 'shared' && n.name === 'band');
  if (band?.kind !== 'shared') throw Error('band');
  band.purpose = 'instrument';
  const rows = instruments(doc),
    group = rows.find((r) => r.name === 'band')!,
    unused = rows.find((r) => r.name === 'drum')!;
  expect(group.uses).toHaveLength(1);
  expect(unused.uses).toEqual([]);
  const [whole, isolated, child] = await Promise.all(
    [generate(doc), generate(doc, { only: group.id }), generate(doc, { only: unused.id })].map(
      (s) => queryEventsNode(s, 0, 2),
    ),
  );
  expect(isolated).toEqual(whole);
  expect(child.events).toEqual([]);
});
it('localized documents are import/generate idempotent apart from ids and spans', () => {
  const doc = load(
    'const drum=s("bd"); const drop=stack(drum,s("hh")); arrange([2,drop],[2,drop])',
  );
  const local = accept(setUseMuted(doc, instruments(doc)[0].id, sections(doc)[0].id, true));
  function clean(doc: Doc): unknown {
    const paths = new Map<string, string>();
    walk(doc, (n, path) => paths.set(n.id, JSON.stringify(path)));
    function value(v: unknown): unknown {
      if (Array.isArray(v)) return v.map(value);
      if (!v || typeof v !== 'object') return v;
      return Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => k !== 'id' && k !== 'span')
          .map(([k, v]) => [k, k === 'origin' ? paths.get(String(v)) : value(v)]),
      );
    }
    return value(doc);
  }
  const round = load(generate(local));
  expect(clean(round)).toEqual(clean(local));
  expect(clean(load(generate(round)))).toEqual(clean(round));
});
it('source edits of a stored localized pattern preserve its canonical origin', async () => {
  const { replaceFromSource } = await import('../src/document/edits/source-node');
  const { replaceOpaque } = await import('../src/document/edits/source-opaque');
  const doc = load('const drum=s("bd"); const drop=stack(drum); arrange([2,drop],[2,drop])'),
    row = instruments(doc)[0];
  const { copyPattern } = await import('../src/document/edits/section-shared');
  const local = structuredClone(doc);
  const root = voices(local)[0].pattern;
  if (root.core.kind !== 'group') throw Error('arrange');
  root.core.parts[0].pattern = copyPattern(local, row.pattern);
  let address = '';
  walk(local, (n) => {
    if ('core' in n && (n as { origin?: string }).origin === row.pattern.id) address = n.id;
  });
  for (const edit of [replaceFromSource, replaceOpaque]) {
    const next = accept(edit(local, address, 's("cp")'));
    expect(instruments(next).map((r) => r.id)).toEqual([row.id]);
    let origin: unknown;
    walk(next, (n) => {
      if (n.id === address && 'origin' in n) origin = n.origin;
    });
    expect(origin).toBe(row.pattern.id);
  }
});
it('validates shared provenance, inventory purpose, and missing occurrence ids', () => {
  const doc = load('const drum=s("bd"); arrange([2,drum])'),
    entry = doc.body[0],
    root = voices(doc)[0].pattern;
  Object.assign(entry, { nameSource: 'invented', purpose: 'invented' });
  if (root.core.kind !== 'group') throw Error('group');
  Object.assign(root.core.parts[0], { id: '', labelSource: 'invented' });
  expect(checkDoc(doc)).toEqual(
    expect.arrayContaining([
      `Invalid nameSource: ${entry.id}`,
      `Invalid purpose: ${entry.id}`,
      'Missing node id',
      'Invalid labelSource: ',
    ]),
  );
});
