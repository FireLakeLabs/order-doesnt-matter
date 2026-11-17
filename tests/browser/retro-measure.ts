import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import type {} from '../../src/studio/main';
declare global {
  interface Window {
    retroTime: number;
    retroCosts: number[];
    retroMarks: number;
  }
}
async function frames(page: Page, count = 5) {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const tick = () => (--count ? requestAnimationFrame(tick) : resolve());
        requestAnimationFrame(tick);
      }),
    count,
  );
}
export function retroMeasure(test: typeof import('@playwright/test').test, id: string) {
  test(`${id}: score, themes, motion and CPU frame cost`, async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await context.addInitScript(() => {
      window.retroCosts = [];
      window.retroMarks = 0;
      let marks = 0;
      let start = 0,
        drawing = false;
      const fill = CanvasRenderingContext2D.prototype.fillRect;
      const text = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillRect = function (...args) {
        if (!drawing && this.canvas.closest('[data-region="stage-a"]')) {
          start = performance.now();
          drawing = true;
          marks = 0;
        }
        return fill.apply(this, args);
      };
      const round = CanvasRenderingContext2D.prototype.roundRect;
      CanvasRenderingContext2D.prototype.roundRect = function (...args) {
        if (
          this.canvas.closest('[data-region="stage-a"]') &&
          args[1] > 110 &&
          args[1] < this.canvas.clientHeight - 80
        )
          marks++;
        return round.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.fillText = function (...args) {
        if (/^(HIT|[A-G][#-]-?\d)/.test(args[0]) && this.canvas.closest('[data-region="stage-a"]'))
          marks++;
        const result = text.apply(this, args);
        if (
          drawing &&
          args[0].startsWith('cycle ') &&
          this.canvas.closest('[data-region="stage-a"]')
        ) {
          window.retroCosts.push(performance.now() - start);
          window.retroMarks = marks;
          drawing = false;
        }
        return result;
      };
    });
    await context.route('https://raw.githubusercontent.com/**', (route) => {
      const map: Record<string, unknown> = {
        _base: `${new URL(route.request().url()).origin}/retro-sounds/`,
      };
      for (const name of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
        map[name] = ['burst.wav', 'burst.wav', 'burst.wav'];
      return route.fulfill({ json: map });
    });
    await context.route('**/retro-sounds/burst.wav', (route) =>
      route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
    );
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/?inspect&a=${id}&b=${id}&theme=arcade`);
    await page.waitForFunction(() => window.odmStudio.app.canPlay);
    const load = async (name: string) => {
      const source = await readFile(`corpus/programs/${name}.strudel`, 'utf8');
      await page.evaluate((source) => window.odmStudio.load(source), source);
      await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
        'data-score-ready',
        'true',
      );
      await frames(page, 8);
    };
    await load('real-dubstep-arranged');
    await page.evaluate(() => {
      window.retroTime = 10.4;
      window.odmStudio.getPlayhead = () => window.retroTime;
    });
    await page.addStyleTag({
      content:
        '[data-region="stage-a"] {position:fixed;left:0;top:108px;width:1300px;height:760px;z-index:50;border:0} [data-region="stage-a"] > header {display:none} .view-stage {flex:none;width:100%;height:100%}',
    });
    await page.evaluate(() => document.fonts.ready);
    await frames(page, 10);
    const canvas = page.locator('[data-region="stage-a"] canvas');
    await expect(canvas).toHaveAttribute('width', '1300');
    await expect(canvas).toHaveAttribute('height', '760');
    const hash = () =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        let result = 2166136261;
        for (const byte of c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data)
          result = Math.imul(result ^ byte, 16777619);
        return result >>> 0;
      });
    const before = await hash();
    await page.evaluate(() => {
      window.retroTime = 11.2;
    });
    await frames(page, 8);
    expect(await hash()).not.toBe(before);
    await page.evaluate(() => {
      window.retroTime = 10.4;
    });
    await frames(page, 8);
    expect(await hash()).toBe(before);
    await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
      'data-score-ready',
      'true',
    );
    await expect(page.locator('[data-region="stage-b"] canvas')).toHaveCount(1);
    const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/${id}`;
    await mkdir(shots, { recursive: true });
    await page.evaluate(() => {
      window.retroCosts = [];
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let remaining = 320;
          const tick = () => {
            window.retroTime += 140 / 240 / 60;
            if (--remaining) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        }),
    );
    const costs = await page.evaluate(() => window.retroCosts.slice(-300).sort((a, b) => a - b));
    const timing = {
      frames: costs.length,
      median: costs[Math.floor(costs.length / 2)],
      p95: costs[Math.floor(costs.length * 0.95)],
      max: costs.at(-1),
      width: 1300,
      height: 760,
    };
    console.log(`${id} CPU frame cost: ${JSON.stringify(timing)}`);
    await writeFile(`${shots}/frame-cost.json`, JSON.stringify(timing, null, 2));
    await page.evaluate(() => {
      window.retroTime = 10.4;
    });
    for (const theme of ['arcade', 'phosphor', 'pocket', 'riso', 'sunset']) {
      await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
      await page.evaluate(() => document.fonts.ready);
      await frames(page, 8);
      await canvas.screenshot({ path: `${shots}/${theme}-1300x760.png` });
    }
    await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
    await page.addStyleTag({
      content: '[data-region="stage-a"] {top:0;width:1920px;height:1080px}',
    });
    await frames(page);
    await canvas.screenshot({ path: `${shots}/arcade-1920x1080.png` });
    await page.addStyleTag({
      content: '[data-region="stage-a"] {top:108px;width:1300px;height:760px}',
    });
    for (let i = 0; i < 3; i++) {
      await page.evaluate(
        (time) => {
          window.retroTime = time;
        },
        10.4 + (i * 0.05 * 140) / 240,
      );
      await frames(page);
      await canvas.screenshot({ path: `${shots}/motion-${i}.png` });
    }
    await page.evaluate(() => {
      window.retroTime = 1;
    });
    await frames(page, 8);
    await expect.poll(() => page.evaluate(() => window.retroMarks)).toBeGreaterThan(0);
    await frames(page);
    await canvas.screenshot({ path: `${shots}/intro.png` });
    for (const name of ['real-techno', 'micro-dense-stack']) {
      await load(name);
      await page.evaluate(() => {
        window.retroTime = 0.4;
      });
      await frames(page, 8);
      await canvas.screenshot({ path: `${shots}/${name}.png` });
    }
    expect(errors).toEqual([]);
  });
}
