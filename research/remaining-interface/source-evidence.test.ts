import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { instruments, walk, type Setting } from '../../src/document';
import { describeTarget, setConstant, setupSummary } from '../../src/document/edit';
import { generate } from '../../src/generate';
import { queryEventsNode } from '../../tests/node-query';
import { sameOnsets } from '../../src/document/edits/source-shared';

it('distinguishes ordinary setup comments from whole-program fallback comments', () => {
  const ordinary = importStrudel('// Setup note\nsamples({ kick: "kick.wav" });').doc.body[0];
  expect(ordinary).toMatchObject({ kind: 'setup', code: 'samples({ kick: "kick.wav" });' });
  const doc = importStrudel('// Setup note\nfunction accent(p){return p.gain(.5)}; note(60)').doc;
  const fallback = doc.body[0];
  expect(fallback.kind).toBe('setup');
  if (fallback.kind !== 'setup') throw Error('Expected whole-program fallback');
  expect(setupSummary(fallback.code)).toMatch(/^\/\/ Setup note/);
  expect(describeTarget(doc, fallback.id).breadcrumb[1]).toMatch(/^\/\/ Setup note/);
});

it('checks the original Kiln cutoff path through import, target, edit, generation and real events', async () => {
  const doc = importStrudel(readFileSync('corpus/programs/piece-kiln.strudel', 'utf8')).doc;
  const bass = instruments(doc).find((row) => row.name === 'bass')!;
  let cutoff: Setting | undefined;
  walk(doc, (node) => {
    if ('name' in node && 'value' in node && node.name === 'cutoff') cutoff = node as Setting;
  });
  expect(describeTarget(doc, cutoff!.id).value).toBe(700);
  const edited = setConstant(doc, cutoff!.id, 900);
  if ('ok' in edited) throw Error(edited.reason);
  const before = await queryEventsNode(generate(doc, { only: bass.id }), 4, 12);
  const after = await queryEventsNode(generate(edited, { only: bass.id }), 4, 12);
  expect(before.error).toBeNull();
  expect(after.error).toBeNull();
  expect(after.events.length).toBeGreaterThan(0);
  expect(after.events.every((e) => (e.value as { cutoff: number }).cutoff === 900)).toBe(true);
  expect(sameOnsets(before, await queryEventsNode(generate(doc, { only: bass.id }), 4, 12))).toBe(
    true,
  );
  expect(describeTarget(doc, cutoff!.id).value).toBe(700);
});
