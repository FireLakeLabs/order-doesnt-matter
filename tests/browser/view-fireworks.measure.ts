import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../../src/studio/main';
import type { ViewDefinition, ViewFrame } from '../../src/views/types';
import { sky, shellSpark, sparkCount } from '../../src/views/fireworks/model';
import { neededRange } from '../../src/studio/frame';
import { revealView } from './shelf';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/fireworks`;
declare global {
  interface Window {
    fireworksCosts: number[];
    fireworksFrame: ViewFrame;
    fireworksFrameB: ViewFrame;
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
function markSizes(frame: ViewFrame) {
  const scene = sky(frame);
  const latest = new Map<string, (typeof scene.shells)[number]>();
  const intervals: [number, number][] = [];
  for (const shell of scene.shells) {
    if (shell.age < 0) {
      intervals.push([shell.y - 3, scene.floor]);
      continue;
    }
    const old = latest.get(shell.instrument.id);
    if (!old || old.event.note.start < shell.event.note.start)
      latest.set(shell.instrument.id, shell);
  }
  const marks = [...latest.values()].map((shell) => {
    const points = Array.from({ length: sparkCount }, (_, i) => shellSpark(shell, i));
    const xs = [shell.targetX, ...points.map((p) => p.x)];
    const ys = [shell.targetY];
    for (const p of points) {
      ys.push(p.y);
      const denominator = shell.targetY - 2 * p.cy + p.y;
      const t = denominator ? (shell.targetY - p.cy) / denominator : 0;
      if (t > 0 && t < 1)
        ys.push((1 - t) ** 2 * shell.targetY + 2 * (1 - t) * t * p.cy + t * t * p.y);
    }
    const left = Math.max(0, Math.min(...xs)),
      right = Math.min(frame.width, Math.max(...xs));
    const top = Math.max(0, Math.min(...ys)),
      bottom = Math.min(frame.height, Math.max(...ys));
    intervals.push([top, bottom]);
    return {
      name: shell.instrument.name,
      sound: shell.event.note.value.s,
      midi: shell.event.midi,
      start: shell.event.note.start,
      widthPx: right - left,
      heightPx: bottom - top,
    };
  });
  let last = Math.max(22, (24 * frame.width) / 960) + 35,
    emptyBand = 0;
  for (const [top, bottom] of intervals.sort((a, b) => a[0] - b[0])) {
    emptyBand = Math.max(emptyBand, top - last);
    last = Math.max(last, bottom);
  }
  emptyBand = Math.max(emptyBand, scene.floor - last);
  return {
    width: frame.width,
    height: frame.height,
    marks,
    longestEmptySkyBandPx: emptyBand,
    minSparkTipDiameterPx: 2 * Math.max(2, (2 * frame.width) / 960),
    padLabelPx: Math.max(12, (11 * frame.width) / 960),
  };
}
test('Fireworks: real-piece sky, five themes, reversible time and CPU frame cost', async ({
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
      _base: 'https://raw.githubusercontent.com/fireworks-sounds/',
    };
    for (const name of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      bank[name] = ['burst.wav', 'burst.wav', 'burst.wav'];
    return route.fulfill({ json: bank });
  });
  await context.route('**/fireworks-sounds/burst.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('/?inspect&a=fireworks&b=&theme=arcade');
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
      .find((r) => r.name.includes('/fireworks.view-'))!.name;
    const view = (await import(url)).default as ViewDefinition;
    const mount = view.mount;
    window.fireworksCosts = [];
    view.mount = async (element) => {
      const handle = await mount(element);
      return {
        ...handle,
        frame(frame) {
          const start = performance.now();
          handle.frame(frame);
          if (element.closest('[data-region="stage-a"]')) {
            window.fireworksCosts.push(performance.now() - start);
            window.fireworksFrame = frame;
          } else if (element.closest('[data-region="stage-b"]')) window.fireworksFrameB = frame;
        },
      };
    };
  });
  await choose(page, 'punchcard');
  await choose(page, 'fireworks');
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(
    ({ from, to }) =>
      window.fireworksFrame.now === 10.4 &&
      window.fireworksFrame.from === from &&
      window.fireworksFrame.to === to,
    neededRange('window', 10.4, 1, []),
  );
  await expect(page.locator('[data-region="stage-a"] .view-status')).toHaveText('');
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
  await mkdir(shots, { recursive: true });
  const canvas = page.locator('[data-region="stage-a"] canvas');
  await page.screenshot({ path: `${shots}/arcade-2560x1440.png` });
  const frozen = await page.evaluate(() => window.fireworksFrame);
  const scene = sky(frozen);
  const sizingA = markSizes(frozen);
  const counts = {
    flying: scene.flying,
    bursting: scene.bursting,
    fountains: scene.fountains.length,
    particles:
      scene.shells.filter((s) => s.age >= 0).length * sparkCount + scene.fountains.length * 64,
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
      window.fireworksFrame.now === 10.4 &&
      window.fireworksFrame.from === from &&
      window.fireworksFrame.to === to,
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
    await canvas.screenshot({ path: `${shots}/${theme}-sky.png` });
    if (theme === 'riso' || theme === 'pocket')
      await page.screenshot({ path: `${shots}/${theme}-2560x1440.png` });
    await page.evaluate(() => {
      window.fireworksCosts = [];
    });
    await frames(page, 125);
    metrics[theme] = await page.evaluate(() => {
      const costs = window.fireworksCosts.slice(5).sort((a, b) => a - b);
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
  await choose(page, 'fireworks', 'b');
  await page.addStyleTag({
    content: '[data-region="stage-b"] .view-host { width:560px!important }',
  });
  await page.waitForFunction(() => window.fireworksFrameB?.width === 560);
  await frames(page);
  const sizingB = markSizes(await page.evaluate(() => window.fireworksFrameB));
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
  expect(errors).toEqual([]);
  const result = { counts, differentPixels, metrics, sizingA, sizingB, errors };
  console.log('Fireworks measured:', JSON.stringify(result));
  await writeFile(`${shots}/measurements.json`, JSON.stringify(result, null, 2));
});
