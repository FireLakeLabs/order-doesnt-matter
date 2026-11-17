import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../../src/studio/main';
import type { ViewDefinition, ViewFrame } from '../../src/views/types';
import { fitWord, poster } from '../../src/views/headline/model';
import { neededRange } from '../../src/studio/frame';
import { revealView } from './shelf';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/headline`;
declare global {
  interface Window {
    headlineCosts: number[];
    headlineFrame: ViewFrame;
    headlineFrameB: ViewFrame;
  }
}
async function frames(page: Page, count = 3) {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
  }, count);
}
async function choose(page: Page, id: string, stage = 'a') {
  const region = page.locator(`[data-region="stage-${stage}"]`);
  const wide = await page.locator('.wide-shelf').isVisible();
  if (!wide) await region.getByRole('button', { name: 'Views', exact: true }).click();
  const shelf = wide ? page.locator('.wide-shelf') : region.locator('.shelf-popover');
  const choice = shelf.locator(
    `[data-view="${id}"] ${stage === 'a' ? '.view-choice' : '.view-to-b'}`,
  );
  await revealView(choice);
  await choice.click();
  await expect(region.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await expect(region.locator('.view-status')).toHaveText('');
  await frames(page);
}
async function markSizes(page: Page, frame: ViewFrame) {
  const scene = poster(frame);
  const metrics = await page.evaluate(
    ({ scene, theme }) => {
      const canvas = document.createElement('canvas');
      const c = canvas.getContext('2d')!;
      return scene.words.map((word) => {
        c.font = `${word.weight} ${word.fontSize}px "${theme.fontDisplay}"`;
        const m = c.measureText(word.text);
        return {
          width: m.width,
          ascent: m.actualBoundingBoxAscent,
          descent: m.actualBoundingBoxDescent,
        };
      });
    },
    { scene, theme: frame.theme },
  );
  return {
    width: frame.width,
    height: frame.height,
    columns: scene.columns,
    marks: scene.words.map((word, i) => {
      const metric = metrics[i];
      const ink = metric.ascent + metric.descent;
      const fit = fitWord(word, metric.width, ink);
      return {
        name: word.instrument.name,
        fontSizePx: word.fontSize,
        inkHeightPx: ink * fit.scaleY,
        inkWidthPx: metric.width * fit.scaleX + Math.abs(word.slant) * ink,
        rowHeightPx: word.height,
        solid: word.solid,
        weight: word.weight,
        punch: word.punch,
        stretch: word.stretch,
        slant: word.slant,
      };
    }),
  };
}
test('Headline: real-piece poster, five themes, reversible time and CPU frame cost', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await context.route('https://raw.githubusercontent.com/**', (route) => {
    const bank: Record<string, unknown> = {
      _base: 'https://raw.githubusercontent.com/headline-sounds/',
    };
    for (const name of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      bank[name] = ['burst.wav', 'burst.wav', 'burst.wav'];
    return route.fulfill({ json: bank });
  });
  await context.route('**/headline-sounds/burst.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('/?inspect&a=headline&b=&theme=arcade');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page
    .getByLabel('Strudel program')
    .fill(await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'));
  await page.getByRole('button', { name: 'Import program', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await page
    .getByRole('group', { name: 'Window', exact: true })
    .getByRole('button', { name: '1', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Trails', exact: true })
    .getByRole('button', { name: 'short', exact: true })
    .click();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((r) => r.name.includes('/headline.view-'))!.name;
    const view = (await import(url)).default as ViewDefinition;
    const mount = view.mount;
    window.headlineCosts = [];
    view.mount = async (element) => {
      const handle = await mount(element);
      return {
        ...handle,
        frame(frame) {
          const start = performance.now();
          handle.frame(frame);
          if (element.closest('[data-region="stage-a"]')) {
            window.headlineCosts.push(performance.now() - start);
            window.headlineFrame = frame;
          } else if (element.closest('[data-region="stage-b"]')) window.headlineFrameB = frame;
        },
      };
    };
  });
  await choose(page, 'punchcard');
  await choose(page, 'headline');
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(
    ({ from, to }) =>
      window.headlineFrame.now === 10.4 &&
      window.headlineFrame.from === from &&
      window.headlineFrame.to === to,
    neededRange('window', 10.4, 1, []),
  );
  await expect(page.locator('[data-region="stage-a"] .view-status')).toHaveText('');
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
  await mkdir(shots, { recursive: true });
  const canvas = page.locator('[data-region="stage-a"] canvas');
  await page.screenshot({ path: `${shots}/arcade-2560x1440.png` });
  const frozen = await page.evaluate(() => window.headlineFrame);
  const scene = poster(frozen);
  const sizingA = await markSizes(page, frozen);
  const counts = {
    words: scene.words.length,
    solid: scene.words.filter((w) => w.solid).length,
    hollow: scene.words.filter((w) => !w.solid).length,
    activeNotes: scene.words.reduce((sum, w) => sum + w.active, 0),
    recentOnsets: scene.words.reduce((sum, w) => sum + w.hits, 0),
    width: frozen.width,
    height: frozen.height,
    now: frozen.now,
    from: frozen.from,
    to: frozen.to,
  };
  const pixels = () =>
    canvas.evaluate((el: HTMLCanvasElement) =>
      Array.from(el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data),
    );
  const first = await pixels();
  await canvas.screenshot({ path: `${shots}/route-forward.png` });
  // Reach the same now by stepping from 10.15 after a backward seek.
  await page.evaluate(() => window.odmStudio.seek(3));
  await frames(page);
  await page.evaluate(() => window.odmStudio.seek(10.15));
  await frames(page);
  await page.evaluate(() => window.odmStudio.step(1));
  await page.waitForFunction(
    ({ from, to }) =>
      window.headlineFrame.now === 10.4 &&
      window.headlineFrame.from === from &&
      window.headlineFrame.to === to,
    { from: frozen.from, to: frozen.to },
  );
  await frames(page);
  const second = await pixels();
  await canvas.screenshot({ path: `${shots}/route-backward-step.png` });
  let differentPixels = 0;
  for (let i = 0; i < first.length; i += 4)
    if (first.slice(i, i + 4).some((v, k) => v !== second[i + k])) differentPixels++;
  expect(differentPixels).toBe(0);
  const metrics: Record<string, unknown> = {};
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    await canvas.screenshot({ path: `${shots}/${theme}-poster.png` });
    if (theme === 'riso' || theme === 'pocket')
      await page.screenshot({ path: `${shots}/${theme}-2560x1440.png` });
    await page.evaluate(() => {
      window.headlineCosts = [];
    });
    await frames(page, 125);
    metrics[theme] = await page.evaluate(() => {
      const costs = window.headlineCosts.slice(5).sort((a, b) => a - b);
      return {
        frames: costs.length,
        medianMs: costs[Math.floor(costs.length / 2)],
        p95Ms: costs[Math.floor(costs.length * 0.95)],
      };
    });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await frames(page);
  await page.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await choose(page, 'headline', 'b');
  await page.addStyleTag({
    content: '[data-region="stage-b"] .view-host { width:560px!important }',
  });
  await page.waitForFunction(() => window.headlineFrameB?.width === 560);
  await frames(page);
  const sizingB = await markSizes(page, await page.evaluate(() => window.headlineFrameB));
  await page
    .locator('[data-region="stage-b"] canvas')
    .screenshot({ path: `${shots}/stage-b-560.png` });
  await page.evaluate(() => window.odmStudio.seek(8));
  await frames(page);
  await canvas.screenshot({ path: `${shots}/section-start.png` });
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.odmStudio.app.state.playing && window.odmStudio.getPlayhead() > 10.4,
  );
  await frames(page);
  await canvas.screenshot({ path: `${shots}/playing.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  const crowded = {
    ...frozen,
    instruments: Array.from({ length: 20 }, (_, index) => ({
      ...frozen.instruments[index % frozen.instruments.length],
      id: `poster-${index}`,
      index,
      inSection: true,
    })),
  };
  crowded.notes = crowded.instruments.flatMap((instrument, i) =>
    frozen.notes
      .filter((n) => n.instrument === frozen.instruments[i % frozen.instruments.length].id)
      .map((note) => ({ ...note, instrument: instrument.id })),
  );
  const crowdSizing: unknown[] = [];
  const examples: [string, ViewFrame][] = [
    ['twenty-a', crowded],
    ['twenty-b', { ...crowded, width: 560 }],
    ['single', { ...frozen, sections: [], instruments: frozen.instruments.slice(0, 1) }],
  ];
  for (const [name, input] of examples) {
    const surface = await page.evaluateHandle(async (frame) => {
      const url = performance
        .getEntriesByType('resource')
        .find((r) => r.name.includes('/headline.view-'))!.name;
      const view = (await import(url)).default as ViewDefinition;
      const element = document.createElement('div');
      element.style.cssText = `position:fixed;left:0;top:0;z-index:9999;width:${frame.width}px;height:${frame.height}px`;
      document.body.append(element);
      const handle = await view.mount(element);
      handle.frame(frame);
      return { element, handle };
    }, input);
    await page.screenshot({
      path: `${shots}/${name}.png`,
      clip: { x: 0, y: 0, width: input.width, height: input.height },
    });
    crowdSizing.push({ name, ...(await markSizes(page, input)) });
    await surface.evaluate(({ element, handle }) => {
      handle.dispose();
      element.remove();
    });
    await surface.dispose();
  }

  // Read-only probe of the previously reported shared fractional-clear issue.
  const fractionalClear: unknown[] = [];
  for (const id of ['tracker', 'piano-roll', 'punchcard']) {
    await choose(page, id);
    fractionalClear.push(
      await page.evaluate(
        async ({ id, frame }) => {
          const url = performance
            .getEntriesByType('resource')
            .find((r) => r.name.includes(`/${id}.view-`))!.name;
          const view = (await import(url)).default as ViewDefinition;
          const results = [];
          for (const dpr of [1, 2]) {
            const element = document.createElement('div');
            const handle = await view.mount(element);
            const input = { ...frame, width: 1299, height: 674.5, dpr };
            handle.frame(input);
            const canvas = element.querySelector('canvas')!;
            const c = canvas.getContext('2d')!;
            const before = c.getImageData(0, canvas.height - 1, canvas.width, 1).data;
            handle.frame(input);
            const after = c.getImageData(0, canvas.height - 1, canvas.width, 1).data;
            let differentPixels = 0;
            for (let p = 0; p < before.length; p += 4)
              if (before.slice(p, p + 4).some((v, k) => v !== after[p + k])) differentPixels++;
            results.push({ dpr, differentPixels, firstAlpha: before[3], secondAlpha: after[3] });
            handle.dispose();
          }
          return { id, width: 1299, height: 674.5, results };
        },
        { id, frame: frozen },
      ),
    );
  }
  expect(errors).toEqual([]);
  const result = {
    counts,
    differentPixels,
    metrics,
    sizingA,
    sizingB,
    crowdSizing,
    fractionalClear,
    errors,
  };
  console.log('Headline measured:', JSON.stringify(result));
  await writeFile(`${shots}/measurements.json`, JSON.stringify(result, null, 2));
});
