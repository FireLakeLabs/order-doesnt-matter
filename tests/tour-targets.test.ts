import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importStrudel } from '../src/import';
import { describeTarget } from '../src/document/edit';
import { kilnTargets, lessons } from '../src/app/tour/targets';
import { queryEventsNode } from './node-query';
import { generate } from '../src/generate';
test('eight lessons resolve real Kiln cutoff and arrangement relationships with real score answers', async () => {
  const doc = importStrudel(readFileSync('corpus/programs/piece-kiln.strudel', 'utf8')).doc;
  const targets = kilnTargets(doc)!;
  expect(lessons).toHaveLength(8);
  expect(targets.first.start).toBe(4);
  expect(targets.first.cycles).toBe(8);
  expect(targets.next.start).toBe(12);
  expect(targets.next.cycles).toBe(16);
  expect(describeTarget(doc, targets.cutoff).value).toBe(700);
  const result = await queryEventsNode(generate(doc, { only: targets.bass }), 4, 12);
  expect(result.error).toBeNull();
  expect(result.events.length).toBeGreaterThan(0);
  expect(result.events.every((event) => (event.value as { cutoff: number }).cutoff === 700)).toBe(
    true,
  );
});
