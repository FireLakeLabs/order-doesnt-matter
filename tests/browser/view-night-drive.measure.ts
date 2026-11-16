import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { prepare } from './view-evidence';
import type { ViewFrame } from '../../src/views/types';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/night-drive`;
async function seek(page: Page, now: number) {
  await page.evaluate(async (now) => {
    window.odmStudio.stop();
    await window.odmStudio.seek(now);
  }, now);
  await page.waitForFunction(
    (now) => window.viewProbe.frame?.now === now && (window.viewProbe.frame?.to ?? 0) > now + 6,
    now,
  );
  await page.evaluate(() => window.odmStudio.pause());
  return page.evaluate(() => window.viewProbe.frame!);
}

test('night-drive: themes, section approach, exact hits, resize, scrubbing and lifetime evidence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'night-drive');
  const intro = await seek(page, 1);
  const drop = await seek(page, 10);
  const approach = await seek(page, 15);
  await mkdir(shots, { recursive: true });
  const standalone = await page.evaluateHandle(async () => {
    await document.fonts.ready;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:9999';
    document.body.append(el);
    const before = window.viewProbe.listeners;
    const handle = await window.viewProbe.definition.mount(el);
    return { el, handle, before };
  });
  const themes: Record<string, Pick<ViewFrame, 'theme' | 'instruments'>> = {};
  for (const name of ['arcade', 'sunset', 'phosphor', 'pocket', 'riso']) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click({ force: true });
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, name);
    themes[name] = await page.evaluate(() => ({
      theme: window.viewProbe.frame!.theme,
      instruments: window.viewProbe.frame!.instruments,
    }));
    // Capture colours at the drop, independent of which section the host last visited.
    const palette = themes[name];
    palette.instruments = drop.instruments.map((i, index) => ({
      ...i,
      colour: palette.instruments[index].colour,
    }));
    await standalone.evaluate(({ handle }, frame) => handle.frame(frame), {
      ...drop,
      ...palette,
      now: 10.4,
      playing: false,
      width: 1300,
      height: 760,
      dpr: 1,
      lookAhead: 6,
    });
    await page.screenshot({
      path: `${shots}/${name}-1300x760.png`,
      clip: { x: 0, y: 0, width: 1300, height: 760 },
    });
  }
  const sunset = {
    ...drop,
    ...themes.sunset,
    now: 10.4,
    playing: false,
    width: 1300,
    height: 760,
    dpr: 1,
    lookAhead: 6,
  };
  await writeFile(`${shots}/frame.json`, JSON.stringify(sunset, null, 2));
  await standalone.evaluate(({ handle }, frame) => handle.frame(frame), {
    ...intro,
    theme: themes.sunset.theme,
    instruments: intro.instruments.map((i, index) => ({
      ...i,
      colour: themes.sunset.instruments[index].colour,
    })),
    now: 1,
    playing: false,
    width: 1300,
    height: 760,
    dpr: 1,
    lookAhead: 6,
  });
  await page.screenshot({
    path: `${shots}/intro-1300x760.png`,
    clip: { x: 0, y: 0, width: 1300, height: 760 },
  });
  await standalone.evaluate(({ handle }, frame) => handle.frame(frame), {
    ...approach,
    ...themes.sunset,
    now: 15,
    playing: false,
    width: 1300,
    height: 760,
    dpr: 1,
    lookAhead: 6,
  });
  await page.screenshot({
    path: `${shots}/section-approach-1300x760.png`,
    clip: { x: 0, y: 0, width: 1300, height: 760 },
  });
  for (let i = 0; i < 4; i++) {
    await standalone.evaluate(({ handle }, frame) => handle.frame(frame), {
      ...sunset,
      now: 11 + (i - 1) * 0.05 * drop.cps,
    });
    await page.screenshot({
      path: `${shots}/gate-${String(i)}.png`,
      clip: { x: 0, y: 0, width: 1300, height: 760 },
    });
  }
  await standalone.evaluate(({ el, handle }, frame) => {
    el.style.width = '1920px';
    el.style.height = '1080px';
    handle.frame({ ...frame, width: 1920, height: 1080 });
  }, sunset);
  await page.screenshot({ path: `${shots}/sunset-1920x1080.png` });
  // Renderer pixels, rather than screenshot encoding, check arbitrary-order time determinism.
  const reverse = await standalone.evaluate(({ el, handle }, frame) => {
    const picture = () => el.querySelector('canvas')!.toDataURL();
    handle.frame(frame);
    const before = picture();
    for (const now of [11, 10, 12, 9, 10.4]) handle.frame({ ...frame, now });
    return { before, after: picture() };
  }, sunset);
  expect(reverse.after).toBe(reverse.before);
  await standalone.evaluate(({ el }) =>
    el.querySelector('canvas')!.dispatchEvent(new Event('webglcontextlost', { cancelable: true })),
  );
  await expect(page.getByRole('alert').filter({ hasText: '3D drawing interrupted' })).toBeVisible();
  const lifetime = await standalone.evaluate(({ el, handle, before }) => {
    handle.dispose();
    el.remove();
    return {
      before,
      after: window.viewProbe.listeners,
      canvases: el.querySelectorAll('canvas').length,
    };
  });
  expect(lifetime.after).toBe(lifetime.before);
  expect(lifetime.canvases).toBe(0);
  expect(errors).toEqual([]);
  // Exercise the second stage through the actual shelf and retain its host screenshot.
  await page.goto('/studio.html?inspect&a=night-drive&b=night-drive&theme=sunset');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(10);
    },
    await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
  );
  await expect(page.locator('[data-region="stage-b"] canvas')).toHaveCount(1);
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await page.screenshot({ path: `${shots}/both-stages-1920x1080.png` });
});

test('night-drive: 300-frame CPU measurement on dubstep', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'night-drive');
  await seek(page, 10);
  const measured = await page.evaluate(async () => {
    const frame = {
      ...window.viewProbe.frame!,
      playing: true,
      width: 1300,
      height: 760,
      dpr: 1,
      lookAhead: 6,
    };
    const el = document.createElement('div');
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    const costs: number[] = [];
    let firstFrame = 0;
    const begun = performance.now();
    for (let i = 0; i < 310; i++) {
      await new Promise(requestAnimationFrame);
      const started = performance.now();
      handle.frame({ ...frame, now: 10 + (i * frame.cps) / 60 });
      const cost = performance.now() - started;
      if (i === 0) firstFrame = cost;

      if (i >= 10) costs.push(cost);
    }
    const canvas = el.querySelector('canvas')!;
    const quality = { scale: canvas.dataset.renderScale, bloom: canvas.dataset.bloom };
    handle.dispose();
    el.remove();
    costs.sort((a, b) => a - b);
    return {
      frames: costs.length,
      median: (costs[149] + costs[150]) / 2,
      p95: costs[285],
      max: costs[299],
      firstFrame,
      elapsedMs: performance.now() - begun,
      quality,
      width: 1300,
      height: 760,
      dpr: 1,
      userAgent: navigator.userAgent,
    };
  });
  await mkdir(shots, { recursive: true });
  await writeFile(`${shots}/measurements.json`, JSON.stringify(measured, null, 2));
  console.log('night-drive CPU submission:', JSON.stringify(measured));
});
for (const file of ['real-techno', 'micro-dense-64'])
  test(`night-drive: ${file} corpus`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepare(page, 'night-drive', file);
    await seek(page, 0.4);
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: `${shots}/${file}-1920x1080.png` });
  });
