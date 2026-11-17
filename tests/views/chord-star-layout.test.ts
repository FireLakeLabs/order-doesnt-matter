import { expect, it } from 'vitest';
import { layout } from '../../src/views/chord-star/layout';

it('meets the card’s width-scaled main sizes on Stage A without spending chart height on the legend', () => {
  for (const [width, height] of [
    [1300, 760],
    [1299, 676],
  ]) {
    const shape = layout({ width, height });
    expect(shape.r).toBeGreaterThanOrEqual(200 * (width / 960));
    expect(shape.dot).toBeGreaterThanOrEqual(12 * (width / 960));
    expect(shape.bass).toBeGreaterThanOrEqual(17 * (width / 960));
    expect(shape.rootFont).toBeGreaterThanOrEqual(76 * (width / 960));
    expect(shape.labelRadius + shape.labelFont / 2).toBeLessThan(height / 2);
  }
});
it('keeps Stage B marks readable and at least the card’s proportional size', () => {
  for (const height of [471, 760]) {
    const shape = layout({ width: 560, height });
    expect(shape.r).toBeGreaterThanOrEqual((200 * 560) / 960);
    expect(shape.dot).toBeGreaterThanOrEqual(7);
    expect(shape.bass).toBeGreaterThanOrEqual(11);
    expect(shape.rootFont).toBeGreaterThanOrEqual((76 * 560) / 960);
    expect(shape.labelFont).toBeGreaterThanOrEqual(13);
    expect(shape.labelRadius + shape.labelFont / 2).toBeLessThan(shape.chartHeight / 2);
  }
});
it('fits all twelve positions in the short Studio canvas while keeping width-scaled note marks and text', () => {
  const shape = layout({ width: 1131, height: 470 });
  expect(shape.r).toBeGreaterThan(180);
  expect(shape.labelRadius + shape.labelFont / 2).toBeLessThan(235);
  expect(shape.dot).toBeGreaterThanOrEqual((12 * 1131) / 960);
  expect(shape.rootFont).toBeGreaterThanOrEqual((76 * 1131) / 960);
});
