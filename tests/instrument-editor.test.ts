import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { describeTarget, instruments, sections, type Doc } from '../src/document';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { queryEventsNode } from './node-query';
import { definitionMuted, setMuted } from '../src/document/edits/set-muted';
import { setUseMuted } from '../src/document/edits/set-use-muted';
import { renameInstrument } from '../src/document/edits/rename-instrument';
import { initialState, loadPiece, setSolo, playbackOptions } from '../src/app/state';
const load = (source: string) => importStrudel(source).doc;
const accept = (result: ReturnType<typeof setMuted>): Doc => {
  if ('ok' in result) throw Error(result.reason);
  return result;
};
const fixture = () =>
  load(
    'const bass=note(36).s("sawtooth"); const kick=s("bd"); const intro=stack(bass,kick); arrange([2,intro],[2,bass])',
  );
it('definition mute and rename preserve untouched branches, refuse stale/non-instrument targets, and round trip', () => {
  const doc = fixture(),
    original = JSON.stringify(doc),
    row = instruments(doc)[0];
  const muted = accept(setMuted(doc, row.id, true));
  expect(muted.body[1]).toBe(doc.body[1]);
  expect(instruments(muted)[0].muted).toBe(true);
  expect(setMuted(muted, row.id, true)).toBe(muted);
  const imported = load(generate(muted));
  expect(instruments(imported)[0].muted).toBe(true);
  expect(instruments(accept(setMuted(imported, instruments(imported)[0].id, false)))[0].muted).toBe(
    false,
  );
  const renamed = accept(renameInstrument(doc, row.id, ' Low end '));
  expect(instruments(renamed)[0]).toMatchObject({ name: 'Low end', nameSource: 'author' });
  expect(renamed.body[1]).toBe(doc.body[1]);
  expect(describeTarget(renamed, row.id)).toMatchObject({
    breadcrumb: ['Low end'],
    generated: false,
  });
  expect(renameInstrument(renamed, row.id, 'Low end')).toBe(renamed);
  expect(generate(renamed)).toContain('Low end');
  for (const id of ['missing', doc.body[0].id]) {
    expect(setMuted(doc, id, true)).toMatchObject({ ok: false });
    expect(renameInstrument(doc, id, 'New')).toMatchObject({ ok: false });
  }
  for (const name of ['', '  ', 'kick', '$bass'])
    expect(renameInstrument(doc, row.id, name)).toMatchObject({ ok: false });
  expect(JSON.stringify(doc)).toBe(original);
});
it('section mute changes only the use; refuses stale sections and absent instruments', () => {
  const doc = fixture(),
    row = instruments(doc)[0],
    [intro, drop] = sections(doc);
  const next = accept(setUseMuted(doc, row.id, intro.id, true));
  expect(next.body[0]).toBe(doc.body[0]);
  expect(instruments(next)[0].uses.map((u) => u.muted)).toEqual([true, false]);
  expect(sections(next)[0].instrumentIds).not.toContain(row.id);
  expect(sections(next)[1].instrumentIds).toContain(row.id);
  expect(setUseMuted(next, row.id, intro.id, true)).toBe(next);
  expect(
    instruments(accept(setUseMuted(next, row.id, intro.id, false)))[0].uses.every((u) => !u.muted),
  ).toBe(true);
  expect(setUseMuted(doc, 'missing', intro.id, true)).toMatchObject({ ok: false });
  expect(setUseMuted(doc, row.id, 'missing', true)).toMatchObject({ ok: false });
  expect(setUseMuted(doc, instruments(doc)[1].id, drop.id, true)).toMatchObject({ ok: false });
});
it('solo is temporary, validates ids, survives document updates, and clears on load', () => {
  const doc = fixture(),
    imported = { doc, warnings: [] };
  const state = loadPiece(initialState(), '', imported),
    id = state.rows[0].id;
  expect(setSolo(state, 'missing')).toBe(state);
  const solo = setSolo(state, id);
  expect(solo.doc).toBe(doc);
  expect(playbackOptions(solo)).toEqual({ only: id });
  expect(
    playbackOptions(Object.assign({}, solo, { doc: accept(setMuted(doc, id, true)) })),
  ).toEqual({ only: id });
  expect(setSolo(solo, null).solo).toBeNull();
  expect(loadPiece(solo, '', imported).solo).toBeNull();
});
it('real house: mute/use mute remove exactly the selected events; rename preserves all event multisets', async () => {
  const doc = load(readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'));
  const rows = instruments(doc),
    kick = rows.find((r) => r.name === 'kick')!,
    chords = rows.find((r) => r.name === 'chords')!;
  const intro = sections(doc).find((s) => s.name === 'intro')!;
  const candidates = [
    accept(setMuted(doc, kick.id, true)),
    accept(setUseMuted(doc, chords.id, intro.id, true)),
    accept(renameInstrument(doc, kick.id, 'Big drum')),
  ];
  for (const row of rows) {
    const results = await Promise.all(
      [doc, ...candidates].map((d) => queryEventsNode(generate(d, { only: row.id }), 0, 28)),
    );
    results.forEach((r) => expect(r.error).toBeNull());
    const events = results[0].events;
    expect(events.length).toBeGreaterThan(0);
    expect(results[1].events).toEqual(row.id === kick.id ? [] : events);
    expect(results[2].events).toEqual(
      row.id === chords.id ? events.filter((e) => e.part[0] >= intro.start + intro.cycles) : events,
    );
    expect(results[3].events).toEqual(events);
  }
  const baseline = await queryEventsNode(generate(doc), 0, 28);
  for (const edited of candidates.slice(0, 2)) {
    const round = load(generate(edited));
    const [before, after] = await Promise.all(
      [edited, round].map((d) => queryEventsNode(generate(d), 0, 28)),
    );
    expect(before.error).toBeNull();
    expect(after.error).toBeNull();
    expect(after.events).toEqual(before.events);
  }
  for (const restored of [
    accept(setMuted(candidates[0], kick.id, false)),
    accept(setUseMuted(candidates[1], chords.id, intro.id, false)),
  ]) {
    const result = await queryEventsNode(generate(restored), 0, 28);
    expect(result.error).toBeNull();
    expect(result.events).toEqual(baseline.events);
  }
  const solo = await queryEventsNode(
    generate(doc, { only: rows.find((r) => r.name === 'bass')!.id }),
    0,
    28,
  );
  expect(solo.error).toBeNull();
  expect(solo.events.length).toBeGreaterThan(0);
});

it('a repeated section can mute one occurrence without changing definition ids or other sections', async () => {
  const doc = fixture(),
    root = doc.body.at(-1)!;
  expect(root.kind).toBe('voice');
  const repeated = load(
    'const bass=note(36).s("sine"); const beat=s("bd"); const drop=stack(bass,beat); arrange([2,drop],[2,drop])',
  );
  const row = instruments(repeated)[0],
    parts = sections(repeated),
    before = JSON.stringify(repeated);
  const next = accept(setUseMuted(repeated, row.id, parts[0].id, true));
  expect(instruments(next).map((r) => r.id)).toEqual(instruments(repeated).map((r) => r.id));
  expect(instruments(next)[0].uses.map((u) => u.muted)).toEqual([true, false]);
  const events = await queryEventsNode(generate(next, { only: row.id }), 0, 4);
  expect(events.error).toBeNull();
  expect(events.events.map((e) => e.part[0])).toEqual([2, 3]);
  expect(JSON.stringify(repeated)).toBe(before);
  const restored = load(generate(next));
  expect(instruments(restored)[0].uses.map((u) => u.muted)).toEqual([true, false]);
  expect(
    instruments(accept(setUseMuted(next, row.id, parts[0].id, false)))[0].uses.every(
      (u) => !u.muted,
    ),
  ).toBe(true);
});
it('standalone mute handles imported pattern mute, preserves names and refuses non-reference uses', async () => {
  const doc = load('s("bd")'),
    row = instruments(doc)[0];
  expect(setMuted(doc, row.id, false)).toBe(doc);
  const muted = accept(setMuted(doc, row.id, true));
  expect((await queryEventsNode(generate(muted), 0, 1)).events).toEqual([]);
  const round = load(generate(muted));
  expect(
    (
      await queryEventsNode(
        generate(accept(setMuted(round, instruments(round)[0].id, false))),
        0,
        1,
      )
    ).events.length,
  ).toBeGreaterThan(0);
  const named = accept(renameInstrument(doc, row.id, 'Drum'));
  expect(instruments(named)[0]).toMatchObject({ name: 'Drum', nameSource: 'author' });
  const arranged = load('arrange([2,s("bd")],[2,s("hh")])');
  expect(
    setUseMuted(arranged, instruments(arranged)[0].id, sections(arranged)[0].id, true),
  ).toMatchObject({ ok: false, reason: expect.stringContaining('reference') });
});

it('refuses a section copy that would split another instrument identity', () => {
  const doc = load(
    'const bass=note(36); const drop=stack(bass,s("hh")); arrange([2,drop],[2,drop])',
  );
  expect(setUseMuted(doc, instruments(doc)[0].id, sections(doc)[0].id, true)).toMatchObject({
    ok: false,
    reason: expect.stringContaining('cannot yet be separated'),
  });
});

it('definition mute remains separate from section mutes', () => {
  const doc = fixture(),
    row = instruments(doc)[0];
  let next = doc;
  for (const part of sections(doc)) next = accept(setUseMuted(next, row.id, part.id, true));
  expect(instruments(next)[0].muted).toBe(true);
  expect(definitionMuted(next, row.id)).toBe(false);
  next = accept(setMuted(next, row.id, true));
  expect(definitionMuted(next, row.id)).toBe(true);
  next = accept(setMuted(next, row.id, false));
  expect(definitionMuted(next, row.id)).toBe(false);
  expect(instruments(next)[0].uses.every((u) => u.muted)).toBe(true);
});

it('real house: solo persists through section/definition mute undo, redo, rename and restart', async () => {
  const { history, push, undo, redo } = await import('../src/editor/history');
  const doc = load(readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'));
  const rows = instruments(doc),
    bass = rows.find((r) => r.name === 'bass')!,
    kick = rows.find((r) => r.name === 'kick')!,
    chords = rows.find((r) => r.name === 'chords')!;
  const intro = sections(doc).find((s) => s.name === 'intro')!;
  let h = history(doc);
  h = push(h, accept(setMuted(h.present, kick.id, true)), kick.id);
  h = push(h, accept(setMuted(h.present, kick.id, false)), kick.id);
  h = push(h, accept(setUseMuted(h.present, chords.id, intro.id, true)), chords.id);
  const solo = setSolo(loadPiece(initialState(), '', { doc: h.present, warnings: [] }), bass.id);
  const snapshots = [h.present];
  h = push(h, accept(renameInstrument(h.present, bass.id, 'Solo bass')), bass.id);
  snapshots.push(h.present);
  h = undo(h); // name
  snapshots.push(h.present);
  h = undo(h); // section mute
  snapshots.push(h.present);
  h = undo(h); // unmute definition
  expect(instruments(h.present).find((r) => r.id === kick.id)!.muted).toBe(true);
  snapshots.push(h.present);
  h = redo(h);
  snapshots.push(h.present);
  const reference = await queryEventsNode(generate(doc, { only: bass.id }), 8, 9);
  expect(reference.error).toBeNull();
  expect(reference.events.length).toBeGreaterThan(2);
  for (const snapshot of snapshots) {
    // The app carries solo outside document history, including transport changes.
    const state = { ...solo, doc: snapshot, rows: instruments(snapshot) };
    expect(state.solo).toBe(bass.id);
    for (const playing of [true, false, true]) {
      const transportState = { ...state, playing };
      const options = playbackOptions(transportState);
      expect(options).toEqual({ only: bass.id });
    }
    expect(await queryEventsNode(generate(snapshot, playbackOptions(state)), 8, 9)).toEqual(
      reference,
    );
  }
  const released = setSolo(solo, null);
  expect(playbackOptions(released)).toEqual({});
  const full = await queryEventsNode(generate(h.present, playbackOptions(released)), 8, 9);
  expect(full.error).toBeNull();
  expect(new Set(full.events.map((e) => (e.value as { s: string }).s)).size).toBe(6);
});
