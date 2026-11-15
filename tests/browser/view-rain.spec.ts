import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../../src/studio/main';

declare global {
  interface Window {
    rainTime: number;
    rainLabels: string[];
    rainCosts: number[];
    rainListeners: number;
  }
}
const shots = '/tmp/odm-view-rain';
async function frames(page: Page, count = 4) {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const tick = () => (--count ? requestAnimationFrame(tick) : resolve());
        requestAnimationFrame(tick);
      }),
    count,
  );
}
const pixels = (page: Page) =>
  page.locator('[data-region="stage-a"] canvas').evaluate((c: HTMLCanvasElement) => {
    const bytes = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  });
async function choose(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name: 'Views', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name }).click();
  await expect(page.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await frames(page);
}
async function load(page: Page, path: string) {
  const source = await readFile(path, 'utf8');
  await page.evaluate((source) => window.odmStudio.load(source), source);
  await expect(page.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await frames(page, 8);
}

test('Rain: real score motion, lifetime, five themes, corpus and frame cost', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await context.addInitScript(() => {
    window.rainListeners = 0;
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const registered = new WeakMap<EventTarget, Map<string, Set<unknown>>>();
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      let types = registered.get(this);
      if (!types) registered.set(this, (types = new Map()));
      let listeners = types.get(type);
      if (!listeners) types.set(type, (listeners = new Set()));
      if (!listeners.has(listener)) {
        listeners.add(listener);
        if (this === window || this === document) window.rainListeners++;
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (
        registered.get(this)?.get(type)?.delete(listener) &&
        (this === window || this === document)
      )
        window.rainListeners--;
      return remove.call(this, type, listener, options);
    };
    window.rainCosts = [];
    let start = 0;
    let drawing = false;
    let labels: string[] = [];
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    const text = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      if (!drawing && this.canvas.closest('[data-region="stage-a"]')) {
        start = performance.now();
        drawing = true;
        labels = [];
      }
      return fill.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      labels.push(args[0]);
      const result = text.apply(this, args);
      if (args[0].startsWith('cycle ') && this.canvas.closest('[data-region="stage-a"]')) {
        window.rainLabels = labels;
        window.rainCosts.push(performance.now() - start);
        drawing = false;
      }
      return result;
    };
  });
  await context.route('https://raw.githubusercontent.com/**', (route) => {
    const map: Record<string, unknown> = {
      _base: `${new URL(route.request().url()).origin}/rain-sounds/`,
    };
    for (const name of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      map[name] = ['burst.wav', 'burst.wav', 'burst.wav'];
    return route.fulfill({ json: map });
  });
  await context.route('**/rain-sounds/burst.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/studio.html?inspect');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await load(page, 'corpus/programs/real-dubstep-arranged.strudel');
  await choose(page, /Rain/);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.odmStudio.app.state.playing && window.odmStudio.getPlayhead() > 0.1,
  );
  const moving = await pixels(page);
  await frames(page, 6);
  expect(await pixels(page)).not.toBe(moving);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await frames(page);
  const stopped = await pixels(page);
  await frames(page);
  expect(await pixels(page)).toBe(stopped);
  // Warm both shelf choices before comparing listener counts (React lazily installs dialog listeners).
  await choose(page, 'Test card diagnostic');
  await choose(page, /Rain/);
  const before = await page.evaluate(() => window.rainListeners);
  for (let i = 0; i < 3; i++) {
    await choose(page, 'Test card diagnostic');
    await choose(page, /Rain/);
    await expect(page.locator('[data-region="stage-a"] canvas')).toHaveCount(1);
  }
  expect(await page.evaluate(() => window.rainListeners)).toBe(before);
  await page.evaluate(() => {
    window.rainTime = 10.4;
    window.odmStudio.getPlayhead = () => window.rainTime;
  });
  // Isolate the requested stage size without changing the production shell.
  await page.addStyleTag({
    content:
      '[data-region="stage-a"] {position:fixed;left:0;top:108px;width:1300px;height:760px;z-index:50;border:0} [data-region="stage-a"] > header {display:none} .view-stage {flex:none;width:100%;height:100%}',
  });
  await page.evaluate(() => document.fonts.ready);
  await frames(page, 8);
  await expect.poll(() => page.evaluate(() => window.rainLabels)).toContain('subBass');
  await mkdir(shots, { recursive: true });
  const canvas = page.locator('[data-region="stage-a"] canvas');
  await expect(canvas).toHaveAttribute('width', '1300');
  await expect(canvas).toHaveAttribute('height', '760');
  const reference = await pixels(page);
  await page.evaluate(() => {
    window.rainTime = 11.4;
  });
  await frames(page);
  expect(await pixels(page)).not.toBe(reference);
  await page.evaluate(() => {
    window.rainTime = 10.4;
  });
  await frames(page);
  expect(await pixels(page)).toBe(reference);
  await page.evaluate(() => {
    window.rainCosts = [];
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let remaining = 320;
        const tick = () => {
          window.rainTime += 140 / 240 / 60;
          if (--remaining === 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  const costs = await page.evaluate(() => window.rainCosts.slice(-300).sort((a, b) => a - b));
  expect(costs).toHaveLength(300);
  expect(costs[150]).toBeLessThan(4);
  const timing = {
    frames: 300,
    median: costs[150],
    p95: costs[285],
    max: costs[299],
    width: 1300,
    height: 760,
  };
  console.log('Rain CPU frame cost:', JSON.stringify(timing));
  await writeFile(`${shots}/frame-cost.json`, JSON.stringify(timing, null, 2));
  await page.evaluate(() => {
    window.rainTime = 10.4;
  });
  await frames(page, 8);
  for (const name of ['arcade', 'phosphor', 'pocket', 'riso', 'sunset']) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    await canvas.screenshot({ path: `${shots}/${name}-1300x760.png` });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.addStyleTag({ content: '[data-region="stage-a"] {top:0;width:1920px;height:1080px}' });
  await frames(page);
  await canvas.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  await page.addStyleTag({
    content: '[data-region="stage-a"] {top:108px;width:1300px;height:760px}',
  });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(
      (time) => {
        window.rainTime = time;
      },
      10.4 + (i * 0.05 * 140) / 240,
    );
    await frames(page);
    await canvas.screenshot({ path: `${shots}/motion-${i}.png` });
  }
  await page.evaluate(() => {
    window.rainTime = 0.4;
  });
  await frames(page, 8);
  await expect.poll(() => page.evaluate(() => window.rainLabels)).toContain('vocalAtmos');
  await canvas.screenshot({ path: `${shots}/intro.png` });
  for (const [name, time] of [
    ['real-techno', 2.4],
    ['micro-dense-stack', 0.4],
  ] as const) {
    await load(page, `corpus/programs/${name}.strudel`);
    await page.evaluate((time) => {
      window.rainTime = time;
    }, time);
    await frames(page, 8);
    await expect
      .poll(() => page.evaluate(() => window.rainLabels))
      .toContain(name === 'real-techno' ? 'cp' : 'sine 2');
    await canvas.screenshot({ path: `${shots}/${name}.png` });
    await expect(page.locator('.view-status')).toHaveText('');
  }
  expect(errors).toEqual([]);
});
