import { expect, it } from 'vitest';
import { parseSteps } from '../src/import/mini';
import { moveSelection, rhythmZoom, rhythmStripWindow } from '../src/editor/kinds/rhythm';
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

it('fine pointers keep an eight-part cycle at 20px; coarse pointers need 44px', () => {
  const steps = parseSteps('c2 d2 e2 f2 g2 a2 b2 c3');
  expect(rhythmZoom(steps, [3], 160, 'fine')).toEqual([]);
  expect(rhythmZoom(steps, [3], 159, 'fine')).toEqual([3]);
  expect(rhythmZoom(steps, [3], 351, 'coarse')).toEqual([3]);
  expect(rhythmZoom(steps, [3], 352, 'coarse')).toEqual([]);
});
it('weighted, nested and simultaneous spans determine fit, not the number of steps', () => {
  expect(rhythmZoom(parseSteps('c2 d2@7'), [0], 159, 'fine')).toEqual([0]);
  expect(rhythmZoom(parseSteps('c2 d2@7'), [0], 160, 'fine')).toEqual([]);
  expect(rhythmZoom(parseSteps('c2 [d2 e2] g2'), [1], 120, 'fine')).toEqual([]);
  expect(rhythmZoom(parseSteps('c2,d2'), [0], 44, 'coarse')).toEqual([]);
  expect(rhythmZoom(parseSteps('hh '.repeat(64)), [32], 1200, 'fine')).toEqual([32]);
});

it('the real-note strip shares a one-cycle zoom scale and retains longer window ranges', () => {
  expect(rhythmStripWindow({ fromCycle: 8, toCycle: 9 }, [0.25, 0.5])).toEqual({
    fromCycle: 8.25,
    toCycle: 8.5,
  });
  expect(rhythmStripWindow({ fromCycle: 8, toCycle: 16 }, [0.25, 0.5])).toEqual({
    fromCycle: 8,
    toCycle: 16,
  });
});
