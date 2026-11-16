import { expect, test } from '@playwright/test';
import { viewEvidence, prepare } from './view-evidence';
import { mkdir } from 'node:fs/promises';

viewEvidence(test, 'ridges');
// Ridges-specific evidence supplements the common five-theme/corpus/CPU sweep.
test('ridges: section approach and continuous cycle slide', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'ridges');
  await page.evaluate(async () => {
    await window.odmStudio.seek(14.4);
    await window.odmStudio.play();
  });
  await page.waitForFunction(() => (window.viewProbe.frame?.to ?? 0) > 17);
  await page.evaluate(() => window.odmStudio.pause());
  const mount = await page.evaluateHandle(async () => {
    const frame = {
      ...window.viewProbe.frame!,
      now: 14.4,
      width: 1300,
      height: 760,
      dpr: 1,
      lookAhead: 6,
    };
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:9999';
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    return { el, handle, frame };
  });
  const path = `${process.env.ODM_VIEW_MEASURE_DIR}/ridges`;
  await mkdir(path, { recursive: true });
  const times: [string, number][] = [
    ['before-breakdown', 14.4],
    ['boundary-before', 14.99],
    ['boundary-after', 15.01],
    ...Array.from({ length: 4 }, (_, i): [string, number] => [
      `consecutive-${String(i)}`,
      14.4 + (i * 0.05 * 140) / 240,
    ]),
  ];
  for (const [name, now] of times) {
    await mount.evaluate(({ handle, frame }, now) => handle.frame({ ...frame, now }), now);
    await page.screenshot({
      path: `${path}/${name}.png`,
      clip: { x: 0, y: 0, width: 1300, height: 760 },
    });
  }
  await mount.evaluate(({ el, handle }) => {
    handle.dispose();
    el.remove();
  });
  await mount.dispose();
  const second = page.locator('[data-region="stage-b"]');
  await second.getByRole('button', { name: 'Views', exact: true }).click();
  await second.getByRole('button', { name: 'Ridges on Stage B', exact: true }).click();
  await expect(second.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await expect(second.locator('canvas[data-ridges]')).toHaveCount(1);
  await page.screenshot({ path: `${path}/both-stages.png` });
});
