import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { scoreReady } from './helpers';

test('Catwalk: exact bar 11, five themes, Stage B, playback and frame cost', async ({ page }) => {
  const dir = `${process.env.ODM_VIEW_MEASURE_DIR}/catwalk`;
  await mkdir(dir, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'catwalk');
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(
    () => window.viewProbe.frame?.now === 10.4 && window.viewProbe.frame.lookAhead === 1,
  );
  await scoreReady(page);
  await writeFile(
    `${dir}/frame.json`,
    JSON.stringify(await page.evaluate(() => window.viewProbe.frame), null, 2),
  );
  for (const [width, height] of [
    [2560, 1440],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['arcade', 'riso', 'pocket', 'phosphor', 'sunset']) {
      await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
      await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        animations: 'disabled',
        path: `${dir}/${theme}-${String(width)}x${String(height)}.png`,
      });
    }
  }
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  const b = page.locator('[data-region="stage-b"]');
  const choice = page.locator('.wide-shelf').getByRole('button', {
    name: 'Catwalk on Stage B',
    exact: true,
    includeHidden: true,
  });
  await revealView(choice);
  await choice.click();
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await b.screenshot({ animations: 'disabled', path: `${dir}/stage-b.png` });
  const stageB = await b.locator('canvas').boundingBox();
  await page.evaluate(() => window.odmStudio.play());
  await page.waitForFunction(
    () => window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ animations: 'disabled', path: `${dir}/playing-2560x1440.png` });
  await page.evaluate(() => window.odmStudio.pause());

  const costs = await page.evaluate(async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    const frame = {
      ...window.viewProbe.frame!,
      now: 10.4,
      width: 1300,
      height: 760,
      dpr: 1,
      lookAhead: 1,
    };
    const result = [];
    for (let i = 0; i < 310; i++) {
      await new Promise(requestAnimationFrame);
      const start = performance.now();
      handle.frame({ ...frame, now: 10.4 + (i * frame.cps) / 60 });
      if (i >= 10) result.push(performance.now() - start);
    }
    // Seek order and a fresh mount must produce identical pixels.
    handle.frame(frame);
    const before = el.querySelector('canvas')!.toDataURL();
    handle.frame({ ...frame, now: 11.1 });
    handle.frame(frame);
    const reversible = before === el.querySelector('canvas')!.toDataURL();
    handle.dispose();
    const fresh = await window.viewProbe.definition.mount(el);
    fresh.frame(frame);
    const remount = before === el.querySelector('canvas')!.toDataURL();
    fresh.dispose();
    el.remove();
    result.sort((a, b) => a - b);
    return {
      frames: result.length,
      median: (result[149] + result[150]) / 2,
      p95: result[285],
      max: result[299],
      width: 1300,
      height: 760,
      dpr: 1,
      reversible,
      remount,
      userAgent: navigator.userAgent,
    };
  });
  expect(costs.reversible).toBe(true);
  expect(costs.remount).toBe(true);
  await writeFile(`${dir}/measurements.json`, JSON.stringify({ ...costs, stageB }, null, 2));
  console.log('Catwalk CPU frame submission:', JSON.stringify({ ...costs, stageB }));
});
