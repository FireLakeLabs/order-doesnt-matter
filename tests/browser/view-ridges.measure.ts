import { expect, test } from '@playwright/test';
import { viewEvidence, prepare } from './view-evidence';
import { mkdir, writeFile } from 'node:fs/promises';
import { terrainDriver } from '../../src/views/ridges/model';
import type { ViewFrame } from '../../src/views/types';

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
    ['spire-before', 14.49],
    ['spire-flare', 14.52],
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

// Local evidence of the real host replacing its queried window; deliberately not a CI gate.
test('ridges: host window refresh during playback', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'ridges', 'real-techno');
  await page.evaluate(() => window.odmStudio.seek(3.95));
  await page.waitForFunction(() => (window.viewProbe.frame?.now ?? 0) >= 3.95);
  const before = await page.evaluate(() => window.viewProbe.frame!);
  await page.evaluate(() => window.odmStudio.play());
  await page.waitForFunction(
    (previousTo) =>
      (window.viewProbe.frame?.now ?? 0) > 4 && (window.viewProbe.frame?.to ?? 0) > previousTo,
    before.to,
  );
  await page.evaluate(() => window.odmStudio.pause());
  const after = await page.evaluate(() => window.viewProbe.frame!);
  const describe = (frame: ViewFrame) => {
    const terrain = terrainDriver(frame);
    return {
      now: frame.now,
      from: frame.from,
      to: frame.to,
      terrain: terrain && {
        instrument: terrain.instrument,
        setting: terrain.setting,
        min: terrain.min,
        max: terrain.max,
      },
    };
  };
  const path = `${process.env.ODM_VIEW_MEASURE_DIR}/ridges`;
  await mkdir(path, { recursive: true });
  await writeFile(
    `${path}/window-refresh.json`,
    JSON.stringify(
      {
        before: describe(before),
        after: describe(after),
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: `${path}/window-refresh.png` });
});

// Face pigment, as well as the crest, must dim when the terrain instrument is muted.
test('ridges: flat ink faces preserve muted state', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'ridges');
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
    await window.odmStudio.play();
  });
  await page.waitForFunction(() => (window.viewProbe.frame?.now ?? 0) >= 10.4);
  await page.evaluate(() => window.odmStudio.pause());
  for (const theme of ['riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    const sample = await page.evaluate(async () => {
      const frame = { ...window.viewProbe.frame!, now: 10.4, width: 1300, height: 760, dpr: 1 };
      const el = document.createElement('div');
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el);
      const copy = document.createElement('canvas');
      copy.width = 1300;
      copy.height = 760;
      const context = copy.getContext('2d')!;
      const draw = (muted: boolean) => {
        handle.frame({ ...frame, instruments: frame.instruments.map((i) => ({ ...i, muted })) });
        context.drawImage(el.querySelector('canvas')!, 0, 0, 1300, 760);
        return [...context.getImageData(80, 700, 1, 1).data].slice(0, 3);
      };
      const live = draw(false),
        quiet = draw(true);
      handle.dispose();
      el.remove();
      return { live, quiet, ground: frame.theme.ground };
    });
    const ground = [1, 3, 5].map((i) => parseInt(sample.ground.slice(i, i + 2), 16));
    const pigment = (colour: number[]) =>
      colour.reduce((sum, n, i) => sum + (n - ground[i]) ** 2, 0);
    expect(pigment(sample.quiet)).toBeLessThan(pigment(sample.live));
  }
});
