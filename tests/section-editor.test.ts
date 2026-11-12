import type { EventResult } from '../src/contract';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { checkDoc, instruments, sections, type Doc } from '../src/document';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { queryEventsNode } from './node-query';
import { initialState, editedPiece, loadPiece, selectSection, tick } from '../src/app/state';
import { renameInstrument } from '../src/document/edits/rename-instrument';
import { history, push, undo } from '../src/editor/history';
import { setSectionLength } from '../src/document/edits/section-length';
import { renameSection } from '../src/document/edits/section-rename';
import { setInstrumentInSection } from '../src/document/edits/section-instrument';
import { moveSection } from '../src/document/edits/section-move';
import { duplicateSection } from '../src/document/edits/section-duplicate';
import { removeSection } from '../src/document/edits/section-remove';
import { addSection } from '../src/document/edits/section-add';
import { separateSection } from '../src/document/edits/section-separate';
import { makeSections } from '../src/document/edits/section-make';
const load = (s: string) => importStrudel(s).doc;
const valid = (result: Doc | { ok: false; reason: string }): Doc => {
  if ('ok' in result) throw Error(result.reason);
  expect(checkDoc(result)).toEqual([]);
  return result;
};
const fixture = () =>
  load(
    'const kick=s("bd"); const hat=s("hh"); const drop=stack(kick,hat); arrange([4,drop],[4,hat],[4,drop])',
  );
async function notes(doc: Doc, from: number, to: number, only?: string) {
  const result = await queryEventsNode(generate(doc, { only }), from, to);
  expect(result.error).toBeNull();
  return onsetNotes(result, from, to);
}
function onsetNotes(result: EventResult, from: number, to: number) {
  return result.events
    .filter((e) => e.whole && e.part[0] === e.whole[0] && e.whole[0] >= from && e.whole[0] < to)
    .map((e) => JSON.stringify([e.whole!.map((t) => Number((t - from).toFixed(9))), e.value]))
    .sort();
}
it('length, names, ordering, duplicate, add, remove and undo preserve immutable structure', () => {
  const doc = fixture(),
    frozen = JSON.stringify(doc),
    [a, b, c] = sections(doc);
  const longer = valid(setSectionLength(doc, a.id, 8));
  expect(sections(longer).map((s) => s.start)).toEqual([0, 8, 12]);
  expect(longer.body[0]).toBe(doc.body[0]);
  const renamed = valid(renameSection(doc, a.id, 'Main part'));
  expect(sections(renamed).map((s) => s.name)).toEqual(['Main part', 'hat', 'Main part']);
  const moved = valid(moveSection(doc, c.id, -1));
  expect(sections(moved).map((s) => s.id)).toEqual([a.id, c.id, b.id]);
  const duplicate = valid(duplicateSection(doc, a.id));
  expect(sections(duplicate).map((s) => s.name)).toEqual(['drop', 'drop', 'hat', 'drop']);
  expect(new Set(sections(duplicate).map((s) => s.id)).size).toBe(4);
  const added = valid(addSection(doc));
  expect(sections(added).at(-1)).toMatchObject({
    cycles: 4,
    nameSource: 'generated',
    instrumentIds: [],
  });
  expect(sections(load(generate(added))).at(-1)?.nameSource).toBe('generated');
  const removed = valid(removeSection(doc, a.id));
  expect(undo(push(history(doc), removed, 'song')).present).toBe(doc);
  expect(JSON.stringify(doc)).toBe(frozen);
  expect(sections(removed).map((s) => s.id)).toEqual([b.id, c.id]);
});
it('refuses invalid addresses, lengths, names, unavailable moves and last removal', () => {
  const doc = fixture(),
    [a, b, c] = sections(doc);
  for (const op of [
    setSectionLength(doc, 'gone', 4),
    renameSection(doc, 'gone', 'x'),
    moveSection(doc, 'gone', 1),
    duplicateSection(doc, 'gone'),
    removeSection(doc, 'gone'),
    separateSection(doc, 'gone'),
    setInstrumentInSection(doc, a.id, 'gone', true),
    setInstrumentInSection(doc, 'gone', instruments(doc)[0].id, false),
  ])
    expect(op).toHaveProperty('ok', false);
  for (const value of [0, -1, NaN, Infinity, 1.5])
    expect(setSectionLength(doc, a.id, value)).toHaveProperty('ok', false);
  for (const name of ['', '  ', 'hat', '$bad'])
    expect(renameSection(doc, a.id, name)).toHaveProperty('ok', false);
  expect(moveSection(doc, a.id, -1)).toHaveProperty('ok', false);
  expect(moveSection(doc, c.id, 1)).toHaveProperty('ok', false);
  expect(separateSection(doc, b.id)).toHaveProperty('ok', false);
  expect(
    removeSection(load('arrange([4,s("bd")])'), sections(load('arrange([4,s("bd")])'))[0].id),
  ).toHaveProperty('ok', false);
  const fractional = load('arrange([0.5,s("bd")])');
  expect(
    sections(valid(setSectionLength(fractional, sections(fractional)[0].id, 1.5)))[0].cycles,
  ).toBe(1.5);
  expect(addSection(load('s("bd")'))).toHaveProperty('ok', false);
  expect(makeSections(doc)).toHaveProperty('ok', false);
});
it('mutes both shared uses, separates one, adds references and refuses unnamed additions', async () => {
  const doc = fixture(),
    [a, b, c] = sections(doc),
    kick = instruments(doc)[0];
  const muted = valid(setInstrumentInSection(doc, a.id, kick.id, false));
  expect(sections(muted).map((s) => s.instrumentIds.includes(kick.id))).toEqual([
    false,
    false,
    false,
  ]);
  const separate = valid(separateSection(doc, a.id));
  expect(sections(separate)[0]).toMatchObject({
    id: a.id,
    name: 'drop 2',
    nameSource: 'generated',
  });
  const local = valid(setInstrumentInSection(separate, a.id, kick.id, false));
  expect(sections(local).map((s) => s.instrumentIds.includes(kick.id))).toEqual([
    false,
    false,
    true,
  ]);
  expect(await notes(local, 8, 12)).toEqual(await notes(doc, 8, 12));
  expect(await notes(muted, 0, 4, kick.id)).toEqual([]);
  expect(
    await notes(valid(setInstrumentInSection(doc, b.id, kick.id, true)), 4, 8, kick.id),
  ).toEqual(await notes(doc, 0, 4, kick.id));
  expect(
    sections(valid(setInstrumentInSection(muted, c.id, kick.id, true)))[0].instrumentIds,
  ).toContain(kick.id);
  const inline = load('arrange([4,s("bd")],[4,s("hh")])');
  expect(
    setInstrumentInSection(inline, sections(inline)[1].id, instruments(inline)[0].id, true),
  ).toMatchObject({ ok: false, reason: expect.stringContaining('Give it a name first') });
});
it('make sections retains note starts; the section order loops while its pattern keeps evolving', async () => {
  const doc = load('note("<60 61 62 63 64 65>").s("sine")'),
    next = valid(makeSections(doc));
  expect(sections(next)[0]).toMatchObject({
    cycles: 4,
    name: 'Section 1',
    nameSource: 'generated',
  });
  expect(await notes(next, 0, 4)).toEqual(await notes(doc, 0, 4));
  expect(await notes(next, 4, 8)).toEqual(await notes(doc, 4, 8));
  expect(await notes(next, 4, 8)).not.toEqual(await notes(next, 0, 4));
});
it('real house: length, membership, separation and order preserve other onset spans and values', async () => {
  const doc = load(readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'));
  const parts = sections(doc),
    rows = instruments(doc),
    kick = rows.find((r) => r.name === 'kick')!;
  const longer = valid(setSectionLength(doc, parts[0].id, 8));
  expect(sections(longer).map((s) => s.start)).toEqual([0, 8, 12, 20, 24]);
  const muted = valid(setInstrumentInSection(doc, parts[2].id, kick.id, false));
  const local = valid(
    setInstrumentInSection(valid(separateSection(doc, parts[2].id)), parts[2].id, kick.id, false),
  );
  const breakdown = parts.find((s) => s.name === 'breakdown')!,
    moved = valid(moveSection(doc, breakdown.id, -1));
  for (const row of rows) {
    const results = await Promise.all(
      [doc, longer, moved, muted, local].map((d) =>
        queryEventsNode(generate(d, { only: row.id }), 0, 32),
      ),
    );
    results.forEach((result) => expect(result.error).toBeNull());
    for (const [i, part] of parts.entries()) {
      const lengthPart = sections(longer)[i],
        movedPart = sections(moved).find((s) => s.id === part.id)!;
      const original = onsetNotes(results[0], part.start, part.start + part.cycles);
      expect(onsetNotes(results[1], lengthPart.start, lengthPart.start + part.cycles)).toEqual(
        original,
      );
      expect(onsetNotes(results[2], movedPart.start, movedPart.start + part.cycles)).toEqual(
        original,
      );
      expect(onsetNotes(results[3], part.start, part.start + part.cycles)).toEqual(
        row.id === kick.id && part.name === 'drop' ? [] : original,
      );
      expect(onsetNotes(results[4], part.start, part.start + part.cycles)).toEqual(
        row.id === kick.id && i === 2 ? [] : original,
      );
    }
  }
  expect(undo(push(history(doc), valid(removeSection(doc, breakdown.id)), 'song')).present).toEqual(
    doc,
  );
});

it('localizes a nested group without muting its uses in other sections', async () => {
  const doc = load(
    'const drums=stack(s("bd"),s("hh")); const a=stack(drums); const b=stack(drums); arrange([4,a],[4,b],[4,a])',
  );
  const [a, b] = sections(doc),
    [kick, hat] = instruments(doc),
    before = JSON.stringify(doc);
  const next = valid(setInstrumentInSection(doc, a.id, kick.id, false));
  expect(await notes(next, 0, 4, kick.id)).toEqual([]);
  expect(await notes(next, 4, 8, kick.id)).toEqual(await notes(doc, 4, 8, kick.id));
  expect(await notes(next, 0, 12, hat.id)).toEqual(await notes(doc, 0, 12, hat.id));
  const separate = valid(separateSection(doc, a.id));
  expect(
    instruments(separate)
      .map((r) => r.id)
      .sort(),
  ).toEqual(
    instruments(doc)
      .map((r) => r.id)
      .sort(),
  );
  expect(await notes(separate, 0, 12)).toEqual(await notes(doc, 0, 12));
  expect(sections(next).find((s) => s.id === b.id)?.instrumentIds).toContain(kick.id);
  expect(JSON.stringify(doc)).toBe(before);
});
it('all structural edits round trip through generated events and keep their other branches', async () => {
  const doc = fixture(),
    [a, b] = sections(doc),
    frozen = JSON.stringify(doc);
  for (const op of [
    renameSection(doc, a.id, 'Main'),
    addSection(doc),
    duplicateSection(doc, a.id),
    removeSection(doc, b.id),
  ]) {
    const next = valid(op),
      imported = load(generate(next));
    expect(await notes(next, 0, 4)).toEqual(await notes(doc, 0, 4));
    expect(await notes(imported, 0, 4)).toEqual(await notes(next, 0, 4));
    expect(next.body[0]).toBe(doc.body[0]);
  }
  expect(await notes(valid(duplicateSection(doc, a.id)), 4, 8)).toEqual(await notes(doc, 0, 4));
  expect(await notes(valid(addSection(doc)), 12, 16)).toEqual([]);
  expect(JSON.stringify(doc)).toBe(frozen);
});
it('adding beside a shared leaf changes its repeated sections, not the instrument definition', async () => {
  const doc = load('const kick=s("bd"); const hat=s("hh"); arrange([4,kick],[4,hat],[4,kick])');
  const [a, b, c] = sections(doc),
    [kick, hat] = instruments(doc);
  const next = valid(setInstrumentInSection(doc, a.id, hat.id, true));
  expect(next.body[0]).toBe(doc.body[0]);
  expect(sections(next).map((s) => s.instrumentIds.includes(hat.id))).toEqual([true, true, true]);
  expect(await notes(next, b.start, b.start + b.cycles, kick.id)).toEqual([]);
  expect(await notes(next, c.start, c.start + c.cycles, hat.id)).toEqual(
    await notes(doc, b.start, b.start + b.cycles, hat.id),
  );
});

it('naming an inline instrument permits adding it by reference', async () => {
  const original = load('arrange([4,s("bd")],[4,s("hh")])'),
    [a, b] = sections(original),
    kick = instruments(original)[0];
  const named = valid(renameInstrument(original, kick.id, 'Kick'));
  const added = valid(setInstrumentInSection(named, b.id, kick.id, true));
  expect(sections(added).map((s) => s.id)).toEqual([a.id, b.id]);
  expect(await notes(added, 0, 4)).toEqual(await notes(original, 0, 4));
  const row = instruments(added).find((r) => r.name === 'Kick')!;
  expect(await notes(added, 4, 8, row.id)).toEqual(await notes(original, 0, 4, kick.id));
});
it('pins the occurrence identity after length and order changes; Follow still uses repeated cycles', () => {
  const doc = fixture(),
    parts = sections(doc);
  const loaded = loadPiece(initialState(), '', { doc, warnings: [] });
  const pinned = selectSection(loaded, parts[1].id);
  const moved = editedPiece(pinned, valid(moveSection(doc, parts[1].id, -1)));
  expect(moved).toMatchObject({ selected: parts[1].id, fromCycle: 0, toCycle: 4, follow: false });
  const length = editedPiece(pinned, valid(setSectionLength(doc, parts[0].id, 8)));
  expect(length).toMatchObject({ selected: parts[1].id, fromCycle: 8, toCycle: 12, follow: false });
  expect(tick({ ...length, follow: true }, 25)).toMatchObject({
    selected: parts[1].id,
    fromCycle: 24,
    toCycle: 28,
  });
});
it('handles inline duplication, leaf separation, no-op membership, and empty-piece refusal', async () => {
  const inline = load('// this comment is not a name\narrange([4,s("bd")],[4,s("hh")])');
  const duplicate = valid(duplicateSection(inline, sections(inline)[0].id));
  expect(sections(duplicate)[0].nameSource).toBe('generated');
  expect(await notes(duplicate, 4, 8)).toEqual(await notes(inline, 0, 4));
  const doc = load('const kick=s("bd"); arrange([4,kick],[4,kick])'),
    [a] = sections(doc),
    row = instruments(doc)[0];
  const separate = valid(separateSection(doc, a.id));
  expect(await notes(separate, 0, 8)).toEqual(await notes(doc, 0, 8));
  expect(instruments(separate).map((r) => r.id)).toEqual([row.id]);
  expect(setInstrumentInSection(doc, a.id, row.id, true)).toBe(doc);
  expect(setSectionLength(doc, a.id, 4)).toBe(doc);
  expect(makeSections({ version: 1, body: [] })).toHaveProperty('ok', false);
});
it('removing a section clears vanished row results and solo without changing surviving selection', () => {
  const doc = load('const kick=s("bd"); const hat=s("hh"); arrange([4,kick],[4,hat])'),
    [a, b] = sections(doc),
    [kick, hat] = instruments(doc);
  const result = { events: [], cps: 0.5, error: null, opaqueValues: false };
  const state = {
    ...loadPiece(initialState(), '', { doc, warnings: [] }),
    selected: b.id,
    solo: kick.id,
    events: { [kick.id]: result, [hat.id]: result },
  };
  const next = editedPiece(state, valid(removeSection(doc, a.id)));
  expect(next).toMatchObject({ selected: b.id, fromCycle: 0, toCycle: 4, solo: null });
  expect(Object.keys(next.events)).toEqual([hat.id]);
});
it('separating an alias retains the settings and rewrites between it and its section', async () => {
  const doc = load(
    'const kick=s("bd"); const base=stack(kick); const drop=base.gain(.3).slow(2); arrange([4,drop],[4,drop])',
  );
  const next = valid(separateSection(doc, sections(doc)[0].id));
  expect(await notes(next, 0, 8)).toEqual(await notes(doc, 0, 8));
});
