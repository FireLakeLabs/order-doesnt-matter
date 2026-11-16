import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type {} from '../../src/studio/main';
import type { ViewDefinition } from '../../src/views/types';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/band`;
declare global {
  interface Window {
    bandCosts: number[];
    bandClock: number | null;
    bandListeners: number;
  }
}
async function frames(page: Page, count = 3) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
  }, count);
}
async function select(page: Page, name: string) {
  const stage = page.locator('[data-region="stage-a"]');
  await stage.getByRole('button', { name: 'Views', exact: true }).click();
  await stage.getByRole('button', { name: `${name} on Stage A`, exact: true }).click();
  await expect(stage.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(stage.locator('canvas')).toHaveCount(1);
}
async function load(page: Page, file: string) {
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  const source = await readFile(`corpus/programs/${file}.strudel`, 'utf8');
  await page.getByLabel('Strudel program').fill(source);
  await page.getByRole('button', { name: 'Import program', exact: true }).click();
  await page.waitForFunction(
    (source) => window.odmStudio.app.state.source === source && window.odmStudio.app.canPlay,
    source,
  );
  await expect(page.locator('[data-region="stage-a"] canvas')).toHaveCount(1);
  await frames(page);
}
const hash = (page: Page) =>
  page.locator('[data-region="stage-a"] canvas').evaluate((canvas: HTMLCanvasElement) => {
    let sum = 0;
    for (const n of canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data)
      sum = Math.imul(sum ^ n, 16777619);
    return sum;
  });

test('The band: real score, reversible motion, five themes, frame cost and lifetime', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await context.route('https://raw.githubusercontent.com/**', async (route) => {
    const map: Record<string, unknown> = {
      _base: `${new URL(route.request().url()).origin}/band-sounds/`,
    };
    for (const name of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      map[name] = ['burst.wav', 'burst.wav', 'burst.wav'];
    await route.fulfill({ json: map });
  });
  await context.route('**/band-sounds/burst.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
  await context.addInitScript(() => {
    window.bandCosts = [];
    window.bandClock = null;
    window.bandListeners = 0;
    // Track listeners owned by canvases; the view must need none.
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (...args) {
      if (this instanceof HTMLCanvasElement) window.bandListeners++;
      return add.apply(this, args);
    };
  });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('/studio.html?inspect&a=band&b=&theme=arcade');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await load(page, 'real-dubstep-arranged');
  await page.waitForFunction(() =>
    performance.getEntriesByType('resource').some((entry) => entry.name.includes('/band.view-')),
  );
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/band.view-'))!.name;
    const definition = (await import(url)).default as ViewDefinition;
    const mount = definition.mount;
    definition.mount = async (element) => {
      const handle = await mount(element);
      return {
        ...handle,
        frame(frame) {
          const start = performance.now();
          handle.frame(frame);
          if (element.closest('[data-region="stage-a"]'))
            window.bandCosts.push(performance.now() - start);
        },
      };
    };
  });
  const canvas = page.locator('[data-region="stage-a"] canvas');
  await expect(canvas).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.odmStudio.app.state.playing && window.odmStudio.getPlayhead() > 0.1,
  );
  const before = await hash(page);
  await frames(page, 6);
  expect(await hash(page)).not.toBe(before);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await frames(page);
  const stopped = await hash(page);
  await frames(page);
  expect(await hash(page)).toBe(stopped);
  const listeners = await page.evaluate(() => window.bandListeners);
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (let i = 0; i < 2; i++) {
    await select(page, 'Test card');
    await select(page, 'The band');
    await expect(canvas).toHaveCount(1);
  }
  expect(await page.evaluate(() => window.bandListeners)).toBe(listeners);
  await page.setViewportSize({ width: 2560, height: 1440 });
  // Freeze score time without touching the engine; the host still builds the real song frame.
  await page.evaluate(() => {
    const original = window.odmStudio.getPlayhead.bind(window.odmStudio);
    window.odmStudio.getPlayhead = () => window.bandClock ?? original();
    window.bandClock = 10.4;
  });
  await expect(page.locator('[data-region="stage-a"] .view-status')).toHaveText('');
  await mkdir(shots, { recursive: true });
  // The host reserves a header in Stage A; set the drawable area to the requested exact size.
  await page.addStyleTag({
    content:
      '[data-region="stage-a"] { overflow:visible } [data-region="stage-a"] .view-host { width:1300px!important; height:760px!important; flex:none }',
  });
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
  const metrics: Record<string, unknown> = {};
  for (const theme of ['arcade', 'phosphor', 'pocket', 'riso', 'sunset']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    await canvas.screenshot({ path: `${shots}/${theme}-1300x760.png` });
    await page.evaluate(() => {
      window.bandCosts = [];
    });
    await frames(page, 305);
    metrics[theme] = await page.evaluate(() => {
      const costs = window.bandCosts.slice(5).sort((a, b) => a - b);
      return {
        frames: costs.length,
        medianMs: costs[Math.floor(costs.length / 2)],
        p95Ms: costs[Math.floor(costs.length * 0.95)],
      };
    });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await page.evaluate(
      (time) => {
        window.bandClock = time;
      },
      10 + i * 0.05 * (140 / 240),
    );
    await frames(page);
    await canvas.screenshot({ path: `${shots}/motion-${i}.png` });
  }
  await page.evaluate(() => {
    window.bandClock = 1;
  });
  await frames(page);
  await canvas.screenshot({ path: `${shots}/intro.png` });
  await page.evaluate(() => {
    window.bandClock = 10.4;
  });
  await frames(page);
  const forward = await hash(page);
  await page.evaluate(() => {
    window.bandClock = 3;
  });
  await frames(page);
  await page.evaluate(() => {
    window.bandClock = 10.4;
  });
  await frames(page);
  expect(await hash(page)).toBe(forward);
  await page.addStyleTag({
    content: '[data-region="stage-a"] .view-host { width:560px!important; height:760px!important }',
  });
  await frames(page);
  await canvas.screenshot({ path: `${shots}/stage-b-560x760.png` });
  await page.addStyleTag({
    content:
      '[data-region="stage-a"] .view-host { width:100%!important; height:100%!important; flex:1 } [data-region="stage-a"] { overflow:hidden }',
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await frames(page);
  await page.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  await load(page, 'real-techno');
  await frames(page);
  await canvas.screenshot({ path: `${shots}/techno.png` });
  await load(page, 'micro-dense-64');
  await frames(page);
  await canvas.screenshot({ path: `${shots}/dense.png` });
  expect(errors).toEqual([]);
  console.log('Band CPU frame cost:', JSON.stringify(metrics));
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify({ metrics, errors, canvasListeners: listeners }, null, 2),
  );
});
