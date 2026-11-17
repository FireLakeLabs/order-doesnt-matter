import { revealView } from './shelf';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';

// Local evidence only; the shared smoke is Runner's complete CI browser test.
test('runner: exact-time pixels, themes, corpus, lifetime and frame cost', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/runner`;
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'runner');
  const second = page.locator('[data-region="stage-b"]');
  await second.getByRole('button', { name: 'Views', exact: true }).click();
  await revealView(
    second.getByRole('button', { name: 'Runner on Stage B', exact: true, includeHidden: true }),
  );
  await second
    .getByRole('button', { name: 'Runner on Stage B', exact: true, includeHidden: true })
    .click();
  await expect(second.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await expect(second.locator('canvas')).toHaveCount(1);
  const at = async (now: number) => {
    await page.evaluate((now) => {
      window.odmStudio.getPlayhead = () => now;
    }, now);
    await page.waitForFunction((now) => window.viewProbe.frame?.now === now, now);
    await page.evaluate(() => document.fonts.ready);
    return page.evaluate(() => ({
      ...window.viewProbe.frame!,
      width: 1300,
      height: 760,
      dpr: 1,
      lookAhead: 4,
    }));
  };
  const intro = await at(1);
  const saved = await at(10.0);
  await page.screenshot({ path: `${shots}/studio-1920x1080.png` });
  await writeFile(`${shots}/frame.json`, JSON.stringify(saved, null, 2));
  const stage = await page.evaluateHandle(async () => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:10000';
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    return { el, handle };
  });
  await stage.evaluate(({ handle }, f) => handle.frame(f), intro);
  await page.screenshot({
    path: `${shots}/intro-1300x760.png`,
    clip: { x: 0, y: 0, width: 1300, height: 760 },
  });
  for (const name of ['arcade', 'phosphor', 'pocket', 'riso', 'sunset']) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click({ force: true });
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, name);
    await page.evaluate(() => document.fonts.ready);
    const themeFrame = await at(10.0);
    await stage.evaluate(({ handle }, f) => handle.frame(f), themeFrame);
    await page.screenshot({
      path: `${shots}/${name}-1300x760.png`,
      clip: { x: 0, y: 0, width: 1300, height: 760 },
    });
  }
  // Six successive frames at 50ms across the kick at cycle 10. The initial
  // frame catches the descent, then the exact landing and the block recoil.
  for (let i = 0; i < 6; i++) {
    await stage.evaluate(
      ({ handle }, { f, i }) => handle.frame({ ...f, now: 10 + (i - 1) * 0.05 * f.cps }),
      { f: saved, i },
    );
    await page.screenshot({
      path: `${shots}/kick-${i}.png`,
      clip: { x: 0, y: 0, width: 1300, height: 760 },
    });
  }
  const pixels = () => stage.evaluate(({ el }) => el.querySelector('canvas')!.toDataURL());
  await stage.evaluate(({ handle }, f) => handle.frame(f), saved);
  const initial = await pixels();
  await stage.evaluate(({ handle }, f) => {
    handle.frame({ ...f, now: 15 });
    handle.frame({ ...f, now: 2 });
    handle.frame(f);
  }, saved);
  expect(await pixels()).toBe(initial);
  await stage.evaluate(({ handle }, f) => handle.frame({ ...f, width: 1920, height: 1080 }), saved);
  await page.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  await stage.evaluate(({ handle }, f) => handle.frame({ ...f, dpr: 2 }), saved);
  expect(await stage.evaluate(({ el }) => el.querySelector('canvas')!.width)).toBe(2600);
  const costs = await stage.evaluate(async ({ handle }, f) => {
    const costs: number[] = [];
    for (let i = 0; i < 310; i++) {
      await new Promise(requestAnimationFrame);
      const start = performance.now();
      handle.frame({ ...f, now: 10 + (i * f.cps) / 60 });
      if (i >= 10) costs.push(performance.now() - start);
    }
    costs.sort((a, b) => a - b);
    return {
      frames: costs.length,
      median: (costs[149] + costs[150]) / 2,
      p95: costs[285],
      max: costs[299],
      width: 1300,
      height: 760,
      dpr: 1,
    };
  }, saved);
  console.log('Runner CPU frame cost:', JSON.stringify(costs));
  await writeFile(`${shots}/frame-cost.json`, JSON.stringify(costs, null, 2));
  await stage.evaluate(
    ({ handle }, f) =>
      handle.frame({
        ...f,
        now: 0.5,
        from: 0,
        to: 1,
        sections: [],
        instruments: Array.from({ length: 20 }, (_, index) => ({
          ...f.instruments[index % f.instruments.length],
          id: String(index),
          name: `Runner ${String(index + 1)}`,
          index,
          inSection: true,
          muted: false,
        })),
        notes: Array.from({ length: 500 }, (_, i) => ({
          instrument: String(i % 20),
          start: i / 500,
          end: (i + 1) / 500,
          hasOnset: true,
          value: {},
        })),
      }),
    saved,
  );
  await page.screenshot({
    path: `${shots}/dense-20-1300x760.png`,
    clip: { x: 0, y: 0, width: 1300, height: 760 },
  });
  await stage.evaluate(({ el, handle }) => {
    handle.dispose();
    el.remove();
  });
  await stage.dispose();
  for (const file of ['real-techno', 'micro-dense-64']) {
    await prepare(page, 'runner', file);
    await at(0.4);
    await page.screenshot({ path: `${shots}/${file}-1920x1080.png` });
  }
  expect(errors).toEqual([]);
});
