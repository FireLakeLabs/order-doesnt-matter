import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { scoreReady } from './helpers';
import { indexTubes, racks } from '../../src/views/tubes/model';
import { tubeLayout } from '../../src/views/tubes/geometry';

test('Tubes: exact bar 11, five themes, Stage B, playback and frame cost', async ({ page }) => {
  const dir = `${process.env.ODM_VIEW_MEASURE_DIR}/tubes`;
  await mkdir(dir, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'tubes');
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 10.4 &&
      window.viewProbe.frame.lookAhead === 1 &&
      window.viewProbe.frame.from === 0 &&
      window.viewProbe.frame.to === 28,
  );
  await scoreReady(page);
  const saved = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${dir}/frame.json`, JSON.stringify(saved, null, 2));
  // Isolated pure-index timing runs in Node; browser submission is measured below.
  const firstIndexStart = performance.now();
  const indexed = indexTubes(saved.notes);
  const firstIndexMs = performance.now() - firstIndexStart;
  const indexCosts: number[] = [];
  for (let i = 0; i < 40; i++) {
    const start = performance.now();
    indexTubes(saved.notes);
    if (i >= 10) indexCosts.push(performance.now() - start);
  }
  indexCosts.sort((a, b) => a - b);
  const indexing = {
    runtime: process.version,
    notes: saved.notes.length,
    firstMs: firstIndexMs,
    medianMs: (indexCosts[14] + indexCosts[15]) / 2,
    p95Ms: indexCosts[28],
    samples: indexCosts.length,
  };
  const current = racks(saved, indexed);
  const bass = current.find((r) => r.instrument.name === 'wobbleBass')!;
  const cutoff = bass.tubes.find((t) => t.setting.name === 'lpf')!;
  const wobbleCutoff = {
    value: cutoff.sample?.value.cutoff,
    min: cutoff.range?.min,
    max: cutoff.range?.max,
    level: cutoff.level,
    moving: cutoff.moving,
    samples: indexed.get(bass.instrument.id)!.onsets.length,
  };
  const sizeAt = (width: number, height: number, label: string) => {
    const layout = tubeLayout({ width, height }, current);
    const tube = layout.tubes.find((t) => t.rack === bass && t.tube.setting.name === 'lpf')!;
    return {
      label,
      stage: { width, height },
      glass: { width: tube.width, height: tube.bottom - tube.top },
      rows: layout.rows,
      tubes: layout.tubes.length,
      folded: layout.chips.filter((c) => c.tube).length,
      mockupGlass: { width: 30, height: 282, stage: { width: 960, height: 600 } },
    };
  };
  const sizes: ReturnType<typeof sizeAt>[] = [];
  expect(wobbleCutoff.level).toBe(0.5);
  expect(wobbleCutoff.moving).toBe(false);
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
      if (theme === 'arcade') {
        const size = await page.evaluate(() => ({
          width: window.viewProbe.frame!.width,
          height: window.viewProbe.frame!.height,
        }));
        sizes.push(
          sizeAt(size.width, size.height, `Stage A at ${String(width)}×${String(height)}`),
        );
      }
    }
  }
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  const b = page.locator('[data-region="stage-b"]');
  const choice = page.locator('.wide-shelf').getByRole('button', {
    name: 'Tubes on Stage B',
    exact: true,
    includeHidden: true,
  });
  await revealView(choice);
  await choice.click();
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await b.screenshot({ animations: 'disabled', path: `${dir}/stage-b.png` });
  const stageB = await b.locator('canvas').boundingBox();
  if (!stageB) throw Error('Stage B canvas is not visible');
  sizes.push(sizeAt(stageB.width, stageB.height, 'Stage B'));
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
    const firstFrameStart = performance.now();
    handle.frame(frame);
    const firstFrameMs = performance.now() - firstFrameStart;
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
      firstFrameMs,
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
  await writeFile(
    `${dir}/measurements.json`,
    JSON.stringify({ ...costs, stageB, indexing, wobbleCutoff, sizes }, null, 2),
  );
  console.log(
    'Tubes CPU frame submission:',
    JSON.stringify({ ...costs, stageB, indexing, wobbleCutoff, sizes }),
  );
});
