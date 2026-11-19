import { test, expect } from '@playwright/test';
import { viewSmoke } from './view-smoke';
import { prepare } from './view-evidence';
import { mobileArms, indexMobile, mobileLayout } from '../../src/views/mobile/model';
viewSmoke(test, 'mobile');
test('Mobile arm drag persists across seeking and double-click restores document order', async ({
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
