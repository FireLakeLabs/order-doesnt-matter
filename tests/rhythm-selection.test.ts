import { expect, it } from 'vitest';
import { parseSteps } from '../src/import/mini';
import { moveSelection, rhythmZoom } from '../src/editor/kinds/rhythm';
it('arrows stay among siblings, enter groups and leave them', () => {
  const steps = parseSteps('c2 [d2 e2] g2');
  expect(moveSelection(steps, [0], 'ArrowRight')).toEqual([1]);
  expect(moveSelection(steps, [1], 'ArrowDown')).toEqual([1, 0]);
  expect(moveSelection(steps, [1, 0], 'ArrowRight')).toEqual([1, 1]);
  expect(moveSelection(steps, [1, 1], 'ArrowRight')).toEqual([1, 1]);
  expect(moveSelection(steps, [1, 1], 'ArrowUp')).toEqual([1]);
  expect(moveSelection(steps, [0], 'ArrowLeft')).toEqual([0]);
  expect(moveSelection(steps, [9], 'ArrowDown')).toEqual([0]);
});
it('zoom uses the nearest touchable group, or a single selected part for flat dense lines', () => {
  const nested = parseSteps('c2 [d2 e2] g2');
  expect(rhythmZoom(nested, [1, 0], 440)).toEqual([]);
  expect(rhythmZoom(nested, [1, 0], 160)).toEqual([1]);
  expect(rhythmZoom(parseSteps('c2 d2 e2 f2 g2 a2 b2 c3'), [3], 280)).toEqual([3]);
  expect(rhythmZoom(nested, [1], 50)).toEqual([1, 0]);
});
