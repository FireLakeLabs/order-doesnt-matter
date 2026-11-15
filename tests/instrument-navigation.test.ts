import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { instruments } from '../src/document';
import { describeTarget, instrumentTargets, setConstant } from '../src/document/edit';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { queryEventsNode } from './node-query';
import { history, push, undo } from '../src/editor/history';

it('Kiln navigation addresses actual editors; cutoff Apply/Undo preserves all other real events', async () => {
  const doc = importStrudel(readFileSync('corpus/programs/piece-kiln.strudel', 'utf8')).doc;
  const original = structuredClone(doc);
  const bass = instruments(doc).find((r) => r.name === 'bass')!;
  const targets = instrumentTargets(doc, bass.id);
  expect(targets.map((t) => t.text)).toEqual(expect.arrayContaining(['lpf', 'Rhythm', 'Rewrites']));
  const cutoff = targets.find((t) => t.text === 'lpf')!;
  expect(describeTarget(doc, cutoff.nodeId)).toMatchObject({
    kind: 'setting-constant',
    value: 700,
  });
  for (const target of targets) expect(describeTarget(doc, target.nodeId).kind).not.toBe('unknown');
  const next = setConstant(doc, cutoff.nodeId, 900);
  if ('ok' in next) throw Error(next.reason);
  const before = await queryEventsNode(generate(doc), 12, 14);
  const after = await queryEventsNode(generate(next), 12, 14);
  expect(before.error).toBeNull();
  expect(after.error).toBeNull();
  const withoutCutoff = (events: typeof before.events) =>
    events.map((e) => ({ ...e, value: { ...(e.value as object), cutoff: undefined } }));
  expect(withoutCutoff(after.events)).toEqual(withoutCutoff(before.events));
  expect(after.events.some((e) => (e.value as { cutoff?: number }).cutoff === 900)).toBe(true);
  expect(undo(push(history(doc), next, cutoff.nodeId)).present).toEqual(doc);
  expect(doc).toEqual(original);
});

it('use-site navigation names the section and keeps its distinct setting address', () => {
  const doc = importStrudel(
    'const bass=note("a2").s("sine"); arrange([2,bass.lpf(700)],[2,bass.lpf(900)])',
  ).doc;
  const targets = instrumentTargets(doc, instruments(doc)[0].id).filter((t) =>
    t.text.startsWith('lpf'),
  );
  expect(targets).toHaveLength(2);
  expect(new Set(targets.map((t) => t.nodeId)).size).toBe(2);
  for (const target of targets) {
    expect(target.text).toContain(' · in ');
    expect(describeTarget(doc, target.nodeId)).toMatchObject({
      kind: 'setting-constant',
      section: expect.any(Object),
    });
  }
});
