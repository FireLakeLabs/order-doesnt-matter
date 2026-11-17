import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import type { ViewFrame } from '../../src/views/types';

declare global {
  interface Window {
    chordStarTime: number;
    chordStarOriginal: () => number;
  }
}
const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/chord-star`;
async function presented(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
}
test('chord-star: real arrangement, five themes, both stages and CPU cost', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 2560, height: 1440 });
  await prepare(page, 'chord-star');
  await page.evaluate(() => {
    history.replaceState(null, '', '/?inspect&a=chord-star&b=');
    window.chordStarTime = 17.3;
    window.chordStarOriginal = window.odmStudio.getPlayhead.bind(window.odmStudio);
    window.odmStudio.getPlayhead = () => window.chordStarTime;
  });
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 17.3 &&
      window.viewProbe.frame.from === 12 &&
      window.viewProbe.frame.to === 28,
  );
  await mkdir(shots, { recursive: true });
  const canvas = page.locator('[data-region="stage-a"] canvas');
  const snapshot = async (name: string) => {
    await presented(page);
    await page.screenshot({ path: `${shots}/${name}.png` });
    await canvas.screenshot({ path: `${shots}/${name}-stage.png` });
  };
  await snapshot('bar18-arcade-2560x1440');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await snapshot('bar18-arcade-1920x1080');
  const original = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.evaluate(() => {
    window.chordStarTime = 10.4;
  });
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 10.4 &&
      window.viewProbe.frame.from === 4 &&
      window.viewProbe.frame.to === 20,
  );
  await snapshot('bar11-arcade-1920x1080');
  await page.evaluate(() => {
    window.chordStarTime = 17.3;
  });
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 17.3 &&
      window.viewProbe.frame.from === 12 &&
      window.viewProbe.frame.to === 28,
  );
  await presented(page);
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(original);
  for (const theme of ['riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await snapshot(`bar18-${theme}-1920x1080`);
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await presented(page);
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const costs = await page.evaluate(async (frame: ViewFrame) => {
    const el = document.createElement('div');
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    const scenarios = [
      { name: 'arrangement', notes: frame.notes, instruments: frame.instruments },
      ...[1, 20].map((count) => ({
        name: `500-notes-${count}-parts`,
        instruments: Array.from({ length: count }, (_, i) => ({
          ...frame.instruments[i % frame.instruments.length],
          id: String(i),
          index: i,
        })),
        notes: Array.from({ length: 500 }, (_, i) => ({
          instrument: String(i % count),
          start: 17,
          end: 18,
          hasOnset: true,
          value: { note: 36 + (i % 48) },
        })),
      })),
    ];
    const dense = scenarios[2];
    scenarios.push({
      ...dense,
      name: '500-staggered-20-parts',
      notes: dense.notes.map((note, i) => ({ ...note, start: 17 + i / 500, end: 18 + i / 500 })),
    });
    const result = [];
    for (const scenario of scenarios) {
      const samples: number[] = [];
      let cold = 0;
      for (let i = 0; i < 310; i++) {
        const start = performance.now();
        handle.frame({
          ...frame,
          ...scenario,
          now: 17.3 + i / 10000,
          width: 1300,
          height: 760,
          dpr: 1,
        });
        const elapsed = performance.now() - start;
        if (i === 0) cold = elapsed;
        if (i >= 10) samples.push(elapsed);
      }
      samples.sort((a, b) => a - b);
      result.push({
        name: scenario.name,
        cold,
        frames: samples.length,
        median: (samples[149] + samples[150]) / 2,
        p95: samples[285],
        max: samples[299],
      });
    }
    handle.dispose();
    el.remove();
    return { scenarios: result, width: 1300, height: 760, dpr: 1, userAgent: navigator.userAgent };
  }, frame);
  console.log('chord-star CPU frame submission:', JSON.stringify(costs));
  await writeFile(`${shots}/frame-cost.json`, JSON.stringify(costs, null, 2));
  const stageB = page.locator('[data-region="stage-b"]');
  await stageB.getByRole('button', { name: 'Views', exact: true }).click();
  const choice = stageB.locator('[data-view="chord-star"] .view-choice');
  await revealView(choice);
  await choice.click();
  const stageStyle = await page.addStyleTag({
    content:
      '[data-region="stage-b"] {position:fixed;right:0;top:108px;width:560px;height:555px;z-index:50;border:0}',
  });
  await expect(stageB.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await presented(page);
  await expect(stageB.locator('canvas')).toHaveJSProperty('clientWidth', 560);
  await stageB.screenshot({ path: `${shots}/bar18-stage-b-560.png` });
  await stageStyle.evaluate((style) => {
    style.parentNode?.removeChild(style);
  });
  await page.evaluate(async () => {
    window.odmStudio.getPlayhead = window.chordStarOriginal;
    await window.odmStudio.seek(17.3);
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.odmStudio.app.state.playing && window.viewProbe.frame?.playing,
  );
  await snapshot('bar18-playing');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(errors).toEqual([]);
});
