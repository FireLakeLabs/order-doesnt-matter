import { test, expect } from '@playwright/test';
import { viewSmoke } from './view-smoke';
import { prepare } from './view-evidence';
import { mobileArms, indexMobile, mobileLayout } from '../../src/views/mobile/model';
viewSmoke(test, 'mobile');
test('Mobile supports tilt under load and arm drag survives seeking and reset', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'mobile');
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 10.4 &&
      window.viewProbe.frame.lookAhead === 1 &&
      window.viewProbe.frame.from === 4 &&
      window.viewProbe.frame.to === 17,
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  const arms = mobileArms(frame, indexMobile(frame.notes));
  const box = mobileLayout(frame.width, frame.height, arms.length);
  const canvas = page.locator('[data-region="stage-a"] canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw Error('Mobile canvas is absent');
  const supports = await canvas.evaluate((c: HTMLCanvasElement, half) => {
    const ctx = c.getContext('2d')!;
    const { beginPath, moveTo, lineTo, stroke } = ctx;
    let points: number[][] = [];
    const rods: { span: number; rise: number }[] = [];
    ctx.beginPath = function () {
      points = [];
      beginPath.call(this);
    };
    ctx.moveTo = function (x, y) {
      points.push([x, y]);
      moveTo.call(this, x, y);
    };
    ctx.lineTo = function (x, y) {
      points.push([x, y]);
      lineTo.call(this, x, y);
    };
    ctx.stroke = function () {
      if (
        points.length === 2 &&
        this.strokeStyle === window.viewProbe.frame!.theme.text.toLowerCase() &&
        this.lineWidth < 3
      ) {
        const span = points[1][0] - points[0][0];
        if (span > half * 2 + 10) rods.push({ span, rise: points[1][1] - points[0][1] });
      }
      Reflect.apply(stroke, this, []);
    };
    try {
      window.viewProbe.handle!.frame(window.viewProbe.frame!);
    } finally {
      Object.assign(ctx, { beginPath, moveTo, lineTo, stroke });
    }
    return rods;
  }, box.half);
  expect(supports).toHaveLength(arms.length - 1);
  expect(supports.every((rod) => Math.abs(rod.rise) > 0.1)).toBe(true);
  expect(supports.sort((a, b) => b.span - a.span)[0].rise).toBeGreaterThan(0);
  const pixels = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const before = await pixels();
  await page.mouse.move(bounds.x + box.centers[0], bounds.y + box.armYs[0]);
  await page.mouse.down();
  await page.mouse.move(bounds.x + box.centers[2], bounds.y + box.armYs[0], { steps: 4 });
  await page.mouse.up();
  const reordered = await pixels();
  expect(reordered).not.toBe(before);
  await page.evaluate(() => window.odmStudio.seek(9));
  await page.waitForFunction(() => window.viewProbe.frame?.now === 9);
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  expect(await pixels()).toBe(reordered);
  await canvas.dblclick({ position: { x: frame.width / 2, y: 70 } });
  expect(await pixels()).toBe(before);
});
