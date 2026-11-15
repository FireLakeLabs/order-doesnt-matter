import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { ViewDefinition, ViewFrame, ViewHandle } from '../../src/views/types';
import type {} from '../../src/studio/main';

const shots = '/tmp/odm-view-loom';
declare global {
  interface Window {
    loomProbe: {
      latest?: ViewFrame;
      definition: ViewDefinition;
      original: ViewDefinition['mount'];
      display?: ViewHandle;
      host?: HTMLDivElement;
    };
  }
}
async function frames(page: Page, count = 3) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
  }, count);
}
async function select(page: Page, name: string) {
  await page.getByRole('button', { name: 'Views', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name }).click();
  await expect(page.locator('[data-region="stage-a"] canvas')).toHaveCount(1);
  await page.waitForFunction(
    () => document.querySelector('.view-host')?.getAttribute('data-score-ready') === 'true',
    undefined,
    { timeout: 0 },
  );
}
async function load(page: Page, path: string) {
  await page.evaluate(
    async (source) => window.odmStudio.load(source),
    await readFile(path, 'utf8'),
  );
  await frames(page);
  await page.waitForFunction(
    () => document.querySelector('.view-host')?.getAttribute('data-score-ready') === 'true',
    undefined,
    { timeout: 0 },
  );
  await page.waitForFunction(() => window.loomProbe.latest?.notes.length);
  await frames(page);
}
async function show(page: Page, now: number, width = 1300, height = 760) {
  await page.evaluate(
    ({ now, width, height }) => {
      const probe = window.loomProbe;
      const source = probe.latest!;
      Object.assign(probe.host!.style, { width: `${width}px`, height: `${height}px` });
      probe.display!.frame({
        ...source,
        instruments: source.instruments.map((instrument) => ({
          ...instrument,
          inSection: source.notes.some(
            (note) => note.instrument === instrument.id && note.start <= now && note.end > now,
          ),
        })),
        width,
        height,
        dpr: 1,
        now,
      });
    },
    { now, width, height },
  );
}

test('Loom: real arrangement, cache cost, five themes, lifecycle, no-section and dense cloth', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await context.route('https://raw.githubusercontent.com/**', async (route) => {
    const map: Record<string, unknown> = {
      _base: `${new URL(route.request().url()).origin}/loom-sounds/`,
    };
    for (const name of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      map[name] = ['burst.wav', 'burst.wav', 'burst.wav'];
    await route.fulfill({ json: map });
  });
  await context.route('**/loom-sounds/burst.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/studio.html?inspect');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await page.getByRole('button', { name: 'Views', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Loom whole song' }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const resource = performance
      .getEntriesByType('resource')
      .find((entry) => /\/loom\.view-[^/]+\.js/.test(entry.name));
    if (!resource) throw Error('Loom chunk was not loaded by the shelf');
    const module = (await import(resource.name)) as { default: ViewDefinition };
    const definition = module.default;
    const original = definition.mount;
    window.loomProbe = { definition, original };
    definition.mount = async (element) => {
      const handle = await original(element);
      return {
        frame(frame) {
          window.loomProbe.latest = frame;
          handle.frame(frame);
        },
        dispose() {
          handle.dispose();
        },
      };
    };
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Loom whole song' }).click();
  await load(page, 'corpus/programs/real-dubstep-arranged.strudel');
  expect(
    await page.evaluate(() => ({
      threads: window.loomProbe.latest!.instruments.length,
      sections: window.loomProbe.latest!.sections.length,
      duration: window.loomProbe.latest!.to - window.loomProbe.latest!.from,
    })),
  ).toEqual({ threads: 13, sections: 5, duration: 28 });
  const canvas = page.locator('[data-region="stage-a"] canvas');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.odmStudio.app.state.playing && window.odmStudio.getPlayhead() > 0.2,
  );
  const before = await canvas.screenshot();
  await frames(page, 5);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  // Capture the real running page at the first drop through the controller's seek API.
  await page.evaluate(async () => {
    window.odmStudio.stop();
    await window.odmStudio.app.play(10.4);
  });
  await page.waitForFunction(() => window.odmStudio.getPlayhead() >= 10.4);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await frames(page);
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/arcade-studio-1920x1080.png` });
  const stopped = await canvas.screenshot();
  await frames(page, 5);
  expect((await canvas.screenshot()).equals(stopped)).toBe(true);

  // Exercise actual stage swap ownership, collecting garbage before listener counts.
  await select(page, 'Test card diagnostic');
  await select(page, 'Loom whole song');
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const listeners = (await cdp.send('Memory.getDOMCounters')).jsEventListeners;
  await select(page, 'Test card diagnostic');
  await select(page, 'Loom whole song');
  await cdp.send('HeapProfiler.collectGarbage');
  expect((await cdp.send('Memory.getDOMCounters')).jsEventListeners).toBeLessThanOrEqual(listeners);

  // Same real score, drawn in an exactly 1300x760 stage for visual comparison and CPU timing.
  await page.evaluate(async () => {
    const probe = window.loomProbe;
    const host = document.createElement('div');
    host.id = 'loom-comparison';
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      width: '1300px',
      height: '760px',
      zIndex: '9999',
    });
    document.body.append(host);
    probe.host = host;
    probe.display = await probe.original(host);
  });
  const comparison = page.locator('#loom-comparison');
  // The overlay is temporarily removed from hit testing so actual theme controls remain usable.
  await comparison.evaluate((host: HTMLElement) => {
    host.style.pointerEvents = 'none';
  });
  for (const theme of ['arcade', 'phosphor', 'pocket', 'riso', 'sunset']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click({ force: true });
    await page.waitForFunction((theme) => window.loomProbe.latest?.theme.name === theme, theme);
    await page.evaluate(() => document.fonts.ready);
    await show(page, 10.4);
    await comparison.screenshot({ path: `${shots}/${theme}-1300x760.png` });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click({ force: true });
  await page.waitForFunction(() => window.loomProbe.latest?.theme.name === 'arcade');
  await show(page, 10.4, 1920, 1080);
  await comparison.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  await show(page, 1);
  await comparison.screenshot({ path: `${shots}/arcade-intro.png` });
  for (let i = 0; i < 3; i++) {
    const cps = await page.evaluate(() => window.loomProbe.latest!.cps);
    await show(page, 10.4 + i * 0.05 * cps);
    await comparison.screenshot({ path: `${shots}/arcade-motion-${i}.png` });
  }
  const costs = await page.evaluate(() => {
    const probe = window.loomProbe;
    const source = { ...probe.latest!, width: 1300, height: 760, dpr: 1, now: 10.4 };
    const run = (rebuild: boolean) => {
      const times: number[] = [];
      const batch = rebuild ? 1 : 10;
      for (let i = 0; i < 360; i++) {
        const frame = {
          ...source,
          now: 10.4 + i / 1000,
          notes: rebuild ? source.notes.slice() : source.notes,
        };
        const start = performance.now();
        for (let j = 0; j < batch; j++) {
          frame.now += 0.0001;
          probe.display!.frame(frame);
        }
        const elapsed = (performance.now() - start) / batch;
        if (i >= 30) times.push(elapsed);
      }
      times.sort((a, b) => a - b);
      return {
        frames: times.length * batch,
        median: times[Math.floor(times.length / 2)],
        p95: times[Math.floor(times.length * 0.95)],
      };
    };
    return { cached: run(false), rebuilt: run(true), notes: source.notes.length };
  });
  expect(costs.cached.median).toBeLessThan(4);
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify({ ...costs, listeners, errors }, null, 2),
  );

  for (const [piece, name] of [
    ['real-techno', 'techno'],
    ['micro-dense-64', 'dense'],
  ]) {
    await load(page, `corpus/programs/${piece}.strudel`);
    expect(await page.evaluate(() => window.loomProbe.latest!.sections)).toHaveLength(0);
    expect(
      await page.evaluate(() => window.loomProbe.latest!.to - window.loomProbe.latest!.from),
    ).toBe(16);
    await show(page, 1.4);
    await comparison.screenshot({ path: `${shots}/${name}-1300x760.png` });
  }
  await page.evaluate(() => {
    const probe = window.loomProbe;
    probe.display!.dispose();
    probe.host!.remove();
    probe.definition.mount = probe.original;
  });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.view-status')).toHaveText('');
  expect(errors).toEqual([]);
});
