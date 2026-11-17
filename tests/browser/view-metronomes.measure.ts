import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import type { ViewFrame } from '../../src/views/types';

// Local evidence only. CI runs view-metronomes.spec.ts's shared smoke.
test('metronomes: exact drop moment, five themes, crowd rule and CPU frame cost', async ({
  page,
}) => {
  const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/metronomes`;
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'metronomes');
  await page.setViewportSize({ width: 2560, height: 1440 });
  const originalClock = await page.evaluateHandle(() => window.odmStudio.getPlayhead);
  await page.evaluate(() => {
    window.odmStudio.getPlayhead = () => 10.4;
    history.replaceState(null, '', '/?inspect&a=metronomes&b=');
  });
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 10.4 &&
      window.viewProbe.frame.from <= 10 &&
      window.viewProbe.frame.to >= 18,
  );
  const presented = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
  const costs: Record<string, unknown> = {};
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await presented();
    await page.screenshot({ path: `${shots}/${theme}-2560x1440.png` });
    costs[theme] = await page.evaluate(async () => {
      const frame = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1 };
      const el = document.createElement('div');
      const handle = await window.viewProbe.definition.mount(el);
      const samples: number[] = [];
      for (let i = 0; i < 310; i++) {
        const start = performance.now();
        handle.frame({ ...frame, now: 10.4 + (i * frame.cps) / 60 });
        if (i >= 10) samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      handle.dispose();
      return {
        frames: samples.length,
        medianMs: (samples[149] + samples[150]) / 2,
        p95Ms: samples[285],
        maxMs: samples[299],
        width: 1300,
        height: 760,
        dpr: 1,
      };
    });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.getByRole('button', { name: 'Metronomes on Stage B', exact: true }).click();
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await presented();
  await page.screenshot({ path: `${shots}/studio-stage-b-2560x1440.png` });
  await page
    .locator('[data-region="stage-b"] canvas')
    .screenshot({ path: `${shots}/stage-b-in-host.png` });
  await page.getByRole('button', { name: 'Clear Stage B', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await presented();
  await page.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  const saved = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${shots}/frame.json`, JSON.stringify(saved, null, 2));
  const standalone = await page.evaluateHandle(async (frame) => {
    const el = document.createElement('div');
    el.id = 'metronomes-evidence';
    el.style.cssText = 'position:fixed;inset:0;width:560px;height:760px;z-index:9999';
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    handle.frame({ ...frame, width: 560, height: 760, dpr: 1 });
    return { el, handle };
  }, saved);
  await page
    .locator('#metronomes-evidence canvas')
    .screenshot({ path: `${shots}/stage-b-560x760.png` });
  for (const [name, count, density] of [
    ['single', 1, 1],
    ['twenty', 20, 8],
    ['fan-500', 1, 500],
  ] as const) {
    await standalone.evaluate(
      ({ el, handle }, { saved, count, density }) => {
        const frame: ViewFrame = {
          ...saved,
          width: 1300,
          height: 760,
          dpr: 1,
          instruments: Array.from({ length: count }, (_, i) => ({
            ...saved.instruments[i % saved.instruments.length],
            id: String(i),
            index: i,
            name: `part ${i + 1}`,
          })),
          notes: Array.from({ length: count }, (_, i) =>
            Array.from({ length: 3 * density }, (_, j) => ({
              instrument: String(i),
              start: 9 + j / density,
              end: 9 + (j + 1) / density,
              hasOnset: true,
              value: {},
            })),
          ).flat(),
        };
        el.style.width = '1300px';
        handle.frame(frame);
      },
      { saved, count, density },
    );
    await page.locator('#metronomes-evidence canvas').screenshot({ path: `${shots}/${name}.png` });
  }
  const deterministic = await standalone.evaluate(({ el, handle }, saved) => {
    const frame = { ...saved, width: 1300, height: 760, dpr: 1 };
    handle.frame(frame);
    const picture = el.querySelector('canvas')!.toDataURL();
    handle.frame({ ...frame, now: 17 });
    handle.frame({ ...frame, now: 3 });
    handle.frame(frame);
    return picture === el.querySelector('canvas')!.toDataURL();
  }, saved);
  expect(deterministic).toBe(true);
  await standalone.evaluate(({ el, handle }) => {
    handle.dispose();
    el.remove();
  });
  await originalClock.evaluate((clock) => {
    window.odmStudio.getPlayhead = clock;
  });
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
    await window.odmStudio.play();
  });
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.evaluate(() => window.odmStudio.pause());
  expect(errors).toEqual([]);
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify({ costs, deterministic, errors }, null, 2),
  );
  console.log('Metronomes CPU frame costs:', JSON.stringify(costs));
});
