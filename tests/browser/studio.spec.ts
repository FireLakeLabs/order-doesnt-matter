import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type {} from '../../src/studio/main';

const shots = '/tmp/odm-studio-foundations';
declare global {
  interface Window {
    studioAudioContexts: number;
  }
}
async function frames(page: Page, count = 4) {
  await page.evaluate(async (count) => {
    await new Promise<void>((resolve) => {
      let remaining = count;
      const tick = () => {
        if (--remaining === 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, count);
}
const pixels = (page: Page) =>
  page.locator('[data-region="stage-a"] canvas').evaluate((canvas: HTMLCanvasElement) => {
    const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  });

test('Studio real piece: transport, themes, pixels, sizing and stage lifetime', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await context.addInitScript(() => {
    window.studioAudioContexts = 0;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.studioAudioContexts++;
      }
    };
  });
  // Deterministic asset delivery only. Controller, score workers, scheduler and audio are real.
  await context.route('https://raw.githubusercontent.com/**', async (route) => {
    const map: Record<string, unknown> = {
      _base: `${new URL(route.request().url()).origin}/studio-sounds/`,
    };
    for (const name of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      map[name] = ['burst.wav', 'burst.wav', 'burst.wav'];
    await route.fulfill({ json: map });
  });
  await context.route('**/studio-sounds/burst.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/studio.html?inspect');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  expect(await page.evaluate(() => window.odmStudio.app.state.source)).toContain(
    '// Original: kiln',
  );
  expect(await page.evaluate(() => window.studioAudioContexts)).toBe(0);
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page
    .getByLabel('Strudel program')
    .fill(await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'));
  await page.getByRole('button', { name: 'Import program', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('instruments').locator('li')).toHaveCount(13);
  await expect(page.getByTestId('instruments')).not.toContainText('Instrument ');
  const canvas = page.locator('[data-region="stage-a"] canvas');
  await expect(canvas).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(
      () =>
        window.odmStudio.app.state.playing &&
        window.odmStudio.app.canPlay &&
        (window.odmStudio.app.engine?.now() ?? 0) > 0.3,
    );
    const before = await pixels(page);
    await frames(page);
    expect(await pixels(page)).not.toBe(before);
    if (cycle === 0) {
      const held = await page.evaluate(() => window.odmStudio.getPlayhead());
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      const paused = await page.evaluate(() => window.odmStudio.getPlayhead());
      await frames(page);
      expect(await page.evaluate(() => window.odmStudio.getPlayhead())).toBe(paused);
      expect(paused).toBeGreaterThanOrEqual(held);
      const resumed = await page.evaluateHandle(() => {
        const app = window.odmStudio.app;
        const engine = app.engine!;
        const play = engine.play.bind(engine);
        let fromCycle: number | undefined;
        engine.play = (code, options) => {
          fromCycle = options?.fromCycle;
          return play(code, options);
        };
        return {
          first: new Promise<{ now: number | null; fromCycle: number | undefined }>((resolve) => {
            const off = app.subscribe((state) => {
              if (state.playing) {
                off();
                resolve({ now: engine.now(), fromCycle });
              }
            });
          }),
          restore: () => {
            engine.play = play;
          },
        };
      });
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      const first = await resumed.evaluate(async ({ first }) => first);
      await resumed.evaluate(({ restore }) => {
        restore();
      });
      await resumed.dispose();
      // Assert the engine's seek request on its first playing notification. Its
      // clock can initially precede that request by Strudel's scheduling margin.
      expect(first.fromCycle).toBe(paused);
      expect(first.now).not.toBeNull();
    }
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await frames(page);
    const stopped = await pixels(page);
    await frames(page);
    expect(await pixels(page)).toBe(stopped);
  }
  expect(await page.evaluate(() => window.studioAudioContexts)).toBe(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.odmStudio.app.state.playing && window.odmStudio.app.canPlay,
  );
  await page.getByRole('button', { name: 'Unmount view', exact: true }).click();
  await expect(canvas).toHaveCount(0);
  await page.getByRole('button', { name: 'Mount view', exact: true }).click();
  await expect(canvas).toHaveCount(1);
  expect(await page.evaluate(() => window.studioAudioContexts)).toBe(1);
  await page.waitForFunction(() =>
    window.odmStudio.app.history.some((event) => event.type === 'trigger'),
  );
  await frames(page);
  await expect(page.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await expect(page.locator('.view-status')).toHaveText('');
  await mkdir(shots, { recursive: true });
  for (const [name, ground] of [
    ['arcade', '#07060D'],
    ['sunset', '#1A0B2E'],
    ['phosphor', '#020A04'],
    ['riso', '#F6F0E4'],
    ['pocket', '#C9DB8E'],
  ]) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', name);
    expect(
      await page
        .locator('html')
        .evaluate((root) =>
          getComputedStyle(root).getPropertyValue('--ground').trim().toUpperCase(),
        ),
    ).toBe(ground);
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    if (['phosphor', 'pocket'].includes(name)) {
      const controls = await page.locator('button').evaluateAll((buttons) =>
        buttons.map((button) => ({
          radius: getComputedStyle(button).borderRadius,
          font: getComputedStyle(button).fontFamily,
        })),
      );
      expect(controls.every((control) => control.radius === '0px')).toBe(true);
      expect(
        controls.every((control) =>
          control.font.includes(name === 'pocket' ? 'Silkscreen' : 'VT323'),
        ),
      ).toBe(true);
    }
    if (name !== 'sunset') await page.screenshot({ path: `${shots}/${name}-1920x1080.png` });
  }
  const railFits = await page.getByTestId('instruments').evaluate(
    (list) =>
      list.scrollHeight <= list.clientHeight &&
      Array.from(list.children).every((row) => {
        const text = row.querySelector('div')!.getBoundingClientRect();
        const box = row.getBoundingClientRect();
        return text.top >= box.top && text.bottom <= box.bottom;
      }),
  );
  expect(railFits).toBe(true);
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(layout.scrollWidth).toBe(layout.width);
  expect(layout.scrollHeight).toBe(layout.height);
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.setViewportSize({ width: 2560, height: 1440 });
  await frames(page);
  await page.screenshot({ path: `${shots}/arcade-2560x1440.png` });
  const sizes = await page.locator('[data-region]').evaluateAll((regions) =>
    Object.fromEntries(
      regions.map((region) => {
        const rect = region.getBoundingClientRect();
        return [region.getAttribute('data-region'), [rect.width, rect.height]];
      }),
    ),
  );
  for (const [name, size] of Object.entries({
    'top-bar': [2560, 52],
    'scrub-strip': [2560, 56],
    'instrument-rail': [300, 760],
    'stage-a': [1300, 760],
    'stage-b': [560, 760],
    'view-shelf': [400, 760],
    score: [2000, 572],
    tray: [560, 572],
  }))
    for (let i = 0; i < 2; i++)
      expect(Math.abs(sizes[name][i] - size[i]) / size[i], `${name} dimension ${i}`).toBeLessThan(
        0.05,
      );
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(
    await page.evaluate(() =>
      window.odmStudio.app.history.filter((event) => event.type === 'error'),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify(
      {
        sizes,
        layout1920: layout,
        railFits,
        audioContexts: await page.evaluate(() => window.studioAudioContexts),
        errors,
      },
      null,
      2,
    ),
  );
});

test('Studio theme persists and denied storage still permits a working page', async ({ page }) => {
  await page.goto('/studio.html');
  await page.getByRole('button', { name: 'Theme riso', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'riso');
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw Error('Denied');
      },
    }),
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'arcade');
  await page.getByRole('button', { name: 'Theme pocket', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pocket');
});
