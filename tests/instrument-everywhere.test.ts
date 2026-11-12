import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { checkDoc, instruments, sections, type Doc, type Setting } from '../src/document';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { setUseMuted } from '../src/document/edits/set-use-muted';
import { separateSection } from '../src/document/edits/section-separate';
import { setInstrumentInSection } from '../src/document/edits/section-instrument';
import { sequenceOwner } from '../src/document/edits/step-shared';
import { setRhythmValue } from '../src/document/edits/rhythm-set';
import { setConstant } from '../src/document/edits/set-constant';
import { addRewrite } from '../src/document/edits/rewrite-add';
import { setRewriteArgument } from '../src/document/edits/rewrite-argument';
import { setSignalRange } from '../src/document/edits/signal-range';
import { history, push, undo } from '../src/editor/history';
import { queryEventsNode } from './node-query';
const accept = (result: Doc | { ok: false; reason: string }): Doc => {
  if ('ok' in result) throw Error(result.reason);
  expect(checkDoc(result)).toEqual([]);
  return result;
};
const row = (doc: Doc, name: string) => instruments(doc).find((r) => r.name === name)!;
const setting = (doc: Doc, name: string, control: string): Setting =>
  row(doc, name)
    .pattern.layers.flatMap((l) => (l.kind === 'settings' ? l.settings : []))
    .find((s) => s.name === control)!;
const edits = [
  [
    'rhythm',
    'bass',
    (d: Doc) => setRhythmValue(d, `${row(d, 'bass').pattern.id}:rhythm`, [0], '83'),
  ],
  ['constant', 'bass', (d: Doc) => setConstant(d, setting(d, 'bass', 'cutoff').id, 900)],
  [
    'rewrite',
    'kick',
    (d: Doc) => {
      const added = accept(addRewrite(d, row(d, 'kick').pattern.id, 'fast'));
      const layer = row(added, 'kick').pattern.layers.at(-1)!;
      return setRewriteArgument(added, layer.id, 0, 2);
    },
  ],
  [
    'signal',
    'percussion · hh',
    (d: Doc) => setSignalRange(d, setting(d, 'percussion · hh', 'gain').id, 0.2, 0.6),
  ],
] as const;
for (const mode of ['mute', 'separate', 'who plays'] as const)
  for (const [kind, name, edit] of edits)
    it(`real house ${mode}: ${kind} reaches every playing section and undo restores the document`, async () => {
      const original = importStrudel(
        readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'),
      ).doc;
      const snapshot = JSON.stringify(original),
        drop = sections(original).find((s) => s.name === 'drop')!;
      let h = history(original);
      const prepared =
        mode === 'mute'
          ? accept(setUseMuted(original, row(original, 'chords').id, drop.id, true))
          : accept(separateSection(original, drop.id));
      h = push(h, prepared, 'prepare');
      if (mode === 'who plays')
        h = push(
          h,
          accept(setInstrumentInSection(h.present, drop.id, row(original, 'kick').id, false)),
          'who',
        );
      const bassCore = sequenceOwner(
        h.present,
        `${row(h.present, 'bass').pattern.id}:rhythm`,
      )!.core;
      if (bassCore.kind !== 'sequence') throw Error('bass sequence');
      expect(generate(h.present).split(JSON.stringify(bassCore.notation))).toHaveLength(2);
      expect(JSON.stringify(h.present)).not.toContain('"origin"');
      const before = h.present,
        after = accept(edit(before));
      h = push(h, after, 'edit');
      // The unseparated version provides an independent expected shared edit.
      const expected = accept(edit(original));
      const notes = async (d: Doc, id: string) => {
        const r = await queryEventsNode(generate(d, { only: id }), 0, 28);
        expect(r.error).toBeNull();
        return r.events
          .filter((e) => e.hasOnset)
          .map((e) => ({ start: e.whole![0], note: JSON.stringify([e.whole, e.value]) }));
      };
      for (const instrument of instruments(original)) {
        const actual = await notes(after, instrument.id);
        if (instrument.name !== name) expect(actual).toEqual(await notes(before, instrument.id));
        else {
          const wanted = (await notes(expected, instrument.id)).filter(
            (e) =>
              !(
                mode === 'who plays' &&
                name === 'kick' &&
                e.start >= drop.start &&
                e.start < drop.start + drop.cycles
              ),
          );
          expect(actual).toEqual(wanted);
          for (const section of sections(before).filter((s) =>
            s.instrumentIds.includes(instrument.id),
          )) {
            const inSection = (xs: typeof actual) =>
              xs.filter(
                (e) => e.start >= section.start && e.start < section.start + section.cycles,
              );
            expect(inSection(actual).length).toBeGreaterThan(0);
            if (
              JSON.stringify(inSection(wanted)) !==
              JSON.stringify(inSection(await notes(before, instrument.id)))
            )
              expect(inSection(actual)).not.toEqual(inSection(await notes(before, instrument.id)));
          }
        }
      }
      if (mode === 'mute')
        expect(
          sections(after)
            .filter((s) => !s.instrumentIds.includes(row(original, 'chords').id))
            .map((s) => s.id),
        ).toContain(drop.id);
      const generated = generate(after);
      expect(generate(importStrudel(generated).doc)).toBe(generated);
      while (h.past.length) h = undo(h);
      expect(h.present).toEqual(original);
      expect(JSON.stringify(original)).toBe(snapshot);
    });
it('separation retains references and promotes inline instruments without copying their content', () => {
  const original = importStrudel(
    'const bass=note("c2 d2").s("sawtooth"); const drop=stack(bass,s("hh")); arrange([2,drop],[2,drop])',
  ).doc;
  const ids = instruments(original).map((r) => r.pattern.id);
  const next = accept(separateSection(original, sections(original)[0].id));
  expect(instruments(next).map((r) => r.pattern.id)).toEqual(ids);
  expect(instruments(next).every((r) => r.uses.length === 2)).toBe(true);
  expect(generate(next).match(/c2 d2/g)).toHaveLength(1);
  expect(generate(next).match(/s\("hh"\)/g)).toHaveLength(1);
  expect(JSON.stringify(next)).not.toContain('"origin"');
  expect(generate(importStrudel(generate(next)).doc)).toBe(generate(next));
});

it('real house: the four edits accumulate after one-drop mute, with exact untouched notes and full undo', async () => {
  const original = importStrudel(
    readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'),
  ).doc;
  const drop = sections(original).find((s) => s.name === 'drop')!;
  const chords = row(original, 'chords');
  let h = push(history(original), accept(setUseMuted(original, chords.id, drop.id, true)), 'mute');
  let expected = original;
  const notes = async (d: Doc, id: string) => {
    const result = await queryEventsNode(generate(d, { only: id }), 0, 28);
    expect(result.error).toBeNull();
    return result.events
      .filter((e) => e.hasOnset)
      .map((e) => ({ start: e.whole![0], value: JSON.stringify([e.whole, e.value]) }));
  };
  for (const [kind, , edit] of edits) {
    h = push(h, accept(edit(h.present)), kind);
    expected = accept(edit(expected));
    for (const instrument of instruments(original)) {
      const wanted = (await notes(expected, instrument.id)).filter(
        (e) =>
          instrument.id !== chords.id ||
          e.start < drop.start ||
          e.start >= drop.start + drop.cycles,
      );
      expect(await notes(h.present, instrument.id)).toEqual(wanted);
    }
    expect(sections(h.present).map((s) => s.instrumentIds.includes(chords.id))).toEqual(
      sections(original).map((s) => s.id !== drop.id && s.instrumentIds.includes(chords.id)),
    );
  }
  while (h.past.length) h = undo(h);
  expect(h.present).toEqual(original);
});

it('an explicitly inventoried group instrument is referenced on separation and use mute', () => {
  const doc = importStrudel('const kit=stack(s("bd"),s("hh")); arrange([2,kit],[2,kit])').doc;
  const definition = doc.body[0];
  if (definition.kind !== 'shared') throw Error('shared');
  definition.purpose = 'instrument';
  const first = sections(doc)[0].id;
  for (const next of [
    accept(separateSection(doc, first)),
    accept(setUseMuted(doc, instruments(doc)[0].id, first, true)),
  ]) {
    expect(instruments(next).map((r) => r.pattern.id)).toEqual([definition.pattern.id]);
    expect(JSON.stringify(next)).not.toContain('"origin"');
    expect(generate(next).match(/s\("bd"\)/g)).toHaveLength(1);
    expect(generate(next).match(/s\("hh"\)/g)).toHaveLength(1);
  }
});
