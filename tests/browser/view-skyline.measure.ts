import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { cityLayout, cityReadout, indexCity } from '../../src/views/skyline/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/skyline`;

test('Skyline: real-page evidence and reported frame cost', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'skyline');
  await page.evaluate(async () => {
    history.replaceState(null, '', '/?inspect&a=skyline&b=&theme=arcade');
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.waitForFunction(
    () =>
      Math.abs(
        (window.viewProbe.frame?.width ?? Infinity) -
          (document.querySelector('[data-region="stage-a"] .view-host')?.clientWidth ?? 0),
      ) < 1,
  );
  await page.evaluate(() => document.fonts.ready);
  const wideSize = await page.evaluate(() => ({
    width: window.viewProbe.frame!.width,
    height: window.viewProbe.frame!.height,
  }));
  await page.screenshot({ path: `${shots}/arcade-2560x1440.png` });
  await page
    .locator('[data-region="stage-a"] canvas')
    .screenshot({ path: `${shots}/arcade-stage-a.png` });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForFunction(
    () =>
      Math.abs(
        (window.viewProbe.frame?.width ?? Infinity) -
          (document.querySelector('[data-region="stage-a"] .view-host')?.clientWidth ?? 0),
      ) < 1,
  );
  await page.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  for (const theme of ['riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${shots}/${theme}-1920x1080.png` });
    await page
      .locator('[data-region="stage-a"] canvas')
      .screenshot({ path: `${shots}/${theme}-stage-a.png` });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.waitForFunction(() => window.viewProbe.frame?.theme.name === 'arcade');
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const city = indexCity(frame);
  const sizes = [
    [960, 600],
    [1300, 760],
    [wideSize.width, wideSize.height],
    [frame.width, frame.height],
    [559, 675],
  ].map(([width, height]) => {
    const box = cityLayout(city, width, height, frame.instruments.length);
    return {
      width,
      height,
      buildingWidth: box.buildingWidth,
      floorPitch: box.pitch,
      windowHeight: box.windowHeight,
      cityTop: box.top,
      street: box.street,
    };
  });
  const mapping = { counts: cityReadout(city, 10.4), sizes, instruments: frame.instruments.length };
  // Profile a separate mount with the real whole-song frame, never a simulated score.
  const measured = await page.evaluate(async () => {
    const source = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1, now: 10.4 };
    const el = document.createElement('div');
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    const texts: string[] = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
      texts.push(text);
      if (max === undefined) fill.call(this, text, x, y);
      else fill.call(this, text, x, y, max);
    };
    handle.frame(source);
    CanvasRenderingContext2D.prototype.fillText = fill;
    const run = (rebuild: boolean) => {
      const times: number[] = [];
      for (let i = 0; i < 330; i++) {
        const frame = {
          ...source,
          now: 10.4 + i / 1000,
          notes: rebuild ? source.notes.slice() : source.notes,
        };
        const start = performance.now();
        handle.frame(frame);
        if (i >= 30) times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      return {
        frames: times.length,
        median: (times[149] + times[150]) / 2,
        p95: times[285],
        max: times[299],
      };
    };
    const result = {
      cached: run(false),
      rebuilt: run(true),
      notes: source.notes.length,
      width: source.width,
      height: source.height,
      texts,
      userAgent: navigator.userAgent,
    };
    // Arbitrary-time rendering is pixel-identical, including after a resize and a backwards seek.
    handle.frame(source);
    const picture = el.querySelector('canvas')!.toDataURL();
    handle.frame({ ...source, now: 22, width: 560 });
    handle.frame(source);
    const deterministic = picture === el.querySelector('canvas')!.toDataURL();
    handle.dispose();
    el.remove();
    return { ...result, deterministic };
  });
  expect(measured.deterministic).toBe(true);
  console.log('Skyline CPU frame cost and mapping:', JSON.stringify({ ...measured, ...mapping }));
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify({ ...measured, ...mapping }, null, 2),
  );

  await page.setViewportSize({ width: 2560, height: 1440 });
  // Use the actual host's Stage B, whose desktop column is 560 pixels wide.
  const choice = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'Skyline on Stage B', exact: true });
  await revealView(choice);
  await choice.click();
  const b = page.locator('[data-region="stage-b"]');
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await expect(b.locator('canvas')).toHaveCount(1);
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  await b.screenshot({ path: `${shots}/stage-b-560.png` });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-2560x1440.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  for (const file of ['real-techno', 'micro-dense-64']) {
    await page.evaluate(
      async (source) => {
        await window.odmStudio.load(source);
        await window.odmStudio.seek(1.4);
      },
      await readFile(`corpus/programs/${file}.strudel`, 'utf8'),
    );
    await page.waitForFunction(
      () =>
        window.viewProbe.frame?.sections.length === 0 &&
        window.viewProbe.frame.notes.length > 0 &&
        window.viewProbe.frame.now === 1.4,
    );
    await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
      'data-score-ready',
      'true',
    );
    await page.screenshot({ path: `${shots}/${file}-2560x1440.png` });
  }
});
