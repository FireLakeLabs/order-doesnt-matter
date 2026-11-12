import { expect, it } from 'vitest';
import { parseSteps } from '../src/import/mini';
import { layoutRhythm, fractionNumber } from '../src/document/edits/rhythm-layout';
import { queryEventsNode } from './node-query';
for (const text of [
  'c2 [~ c2] g1@2 <a1 [a1 g1]>',
  '[c2,e2] [g2 [a2 b2]]',
  'c2!3 d2@2',
  'c2@0.1 d2@0.2',
  '<c2 <d2 e2>>',
  '[[c2@3 ~] [d2 <e2 g2>]]',
])
  it(`structural spans equal real onset wholes over eight cycles: ${text}`, async () => {
    const steps = parseSteps(text);
    const result = await queryEventsNode(`note(${JSON.stringify(text)})`, 0, 8);
    expect(result.error).toBeNull();
    const actual = result.events
      .filter((e) => e.whole && e.part[0] === e.whole[0])
      .map((e) => JSON.stringify([e.whole, (e.value as { note: unknown }).note]))
      .sort();
    const drawn = Array.from({ length: 8 }, (_, cycle) => layoutRhythm(steps, cycle))
      .flat()
      .filter((b) => b.kind === 'value' && b.active)
      .map((b) => JSON.stringify([[fractionNumber(b.start), fractionNumber(b.end)], b.value]))
      .sort();
    expect(drawn).toEqual(actual);
  });
it('decimal weights are rational fractions', () => {
  expect(layoutRhythm(parseSteps('c2@0.1 d2@0.2'))[0].end).toEqual([1, 3]);
});
it('returns exact reduced fractions, paths, depths, and turn labels; source chunks stay opaque', async () => {
  const boxes = layoutRhythm(parseSteps('c2 [d2 e2] <f2 g2>'));
  expect(boxes.find((b) => b.path.join() === '1,1')).toMatchObject({
    start: [1, 2],
    end: [2, 3],
    depth: 1,
  });
  expect(boxes.find((b) => b.path.join() === '2,1')).toMatchObject({ turn: 1, active: false });
  // Every Step kind appears here. Unmodelled timing is explicitly a chunk,
  // never a fabricated note. Its actual notes belong to the worker strip.
  const text = 'c2(3,8) {d2 e2,g2}%3 [a2|b2] c2*2 c2/2 c2?';
  const chunks = layoutRhythm(parseSteps(text));
  expect(chunks.every((b) => b.opaque && b.kind !== 'value')).toBe(true);
  const result = await queryEventsNode(`note(${JSON.stringify(text)})`, 0, 4);
  expect(result.error).toBeNull();
  expect(result.events.length).toBeGreaterThan(0);
});
