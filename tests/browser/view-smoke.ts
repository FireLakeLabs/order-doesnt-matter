import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

// Register a view's complete CI browser check with viewSmoke(test, 'loom').
// Pass Playwright's test and the registry id; this covers Canvas 2D and WebGL.
// Extended checks and measurements belong to npm run measure:views, outside CI.
export function viewSmoke(test: typeof import('@playwright/test').test, id: string) {
  test(`${id}: shared Studio smoke`, async ({ page, context }) => {
    const errors: string[] = [];
    const timed = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
      const start = performance.now();
      if (id === 'coil')
        console.log('COIL_STEP', JSON.stringify({ name, phase: 'start', epoch: Date.now() }));
      try {
        return await run();
      } finally {
        if (id === 'coil')
          console.log(
            'COIL_STEP',
            JSON.stringify({
              name,
              phase: 'end',
              epoch: Date.now(),
              ms: performance.now() - start,
            }),
          );
      }
    };
    if (id === 'coil') {
      await page.addInitScript(() => {
        (globalThis as { coilEvidence?: boolean }).coilEvidence = true;
      });
      page.on('console', (m) => {
        if (m.text().startsWith('COIL_EVIDENCE')) console.log(m.text());
      });
    }
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    // Keep asset delivery local; the real controller, score queries and playback run.
    await context.route('https://raw.githubusercontent.com/**', (route) => {
      const bank: Record<string, unknown> = {
        _base: 'https://raw.githubusercontent.com/view-smoke-sounds/',
      };
      for (const sound of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
        bank[sound] = ['burst.wav', 'burst.wav', 'burst.wav'];
      return route.fulfill({ json: bank });
    });
    await context.route('**/view-smoke-sounds/burst.wav', (route) =>
      route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
    );
    await page.setViewportSize({ width: 1920, height: 1080 });
    const stage = page.locator('[data-region="stage-a"]');
    const canvas = stage.locator('canvas');
    // Capture the presented view within its canvas bounds.
    const picture = async () => {
      const clip = await canvas.boundingBox();
      if (!clip) throw Error('The view canvas is not visible');
      return timed('screenshot', () => page.screenshot({ clip }));
    };
    const presented = () =>
      timed('three-frames-presented', () =>
        page.evaluate(async () => {
          for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
        }),
      );
    const ready = () =>
      timed('score-ready', () =>
        page.waitForFunction(
          () =>
            document
              .querySelector('[data-region="stage-a"] .view-host')
              ?.getAttribute('data-score-ready') === 'true' &&
            document.querySelector('[data-region="stage-a"] .view-status')?.textContent === '',
          undefined,
          { timeout: 0 },
        ),
      );
    const choose = async (view: string) => {
      await stage.getByRole('button', { name: 'Views', exact: true }).click();
      await stage.locator(`.shelf-popover [data-view="${view}"] .view-choice`).click();
      await ready();
      await expect(canvas).toHaveCount(1);
    };
    await timed('navigation', () => page.goto(`/studio.html?a=${encodeURIComponent(id)}`));
    await timed('open-paste', () =>
      page.getByRole('button', { name: 'Paste', exact: true }).click(),
    );
    await page
      .getByLabel('Strudel program')
      .fill(await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'));
    await timed('import', () =>
      page.getByRole('button', { name: 'Import program', exact: true }).click(),
    );
    await timed('import-dialog-hidden', () =>
      page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 0 }),
    );
    await ready();
    await expect(canvas).toHaveCount(1);
    await timed('play-click', () =>
      page.getByRole('button', { name: 'Play', exact: true }).click(),
    );
    await timed('pause-button-ready', () =>
      page.getByRole('button', { name: 'Pause', exact: true }).waitFor({ timeout: 0 }),
    );
    await expect(page.getByRole('status', { name: 'Cycle', exact: true })).toHaveText(
      /^cycle (?!0\.00$)\d+\.\d{2}$/,
    );
    const before = await picture();
    // Synchronize with drawn frames; software WebGL screenshot encoding can
    // itself exceed expect.poll's deadline even while the view is animating.
    await presented();
    expect((await picture()).equals(before)).toBe(false);
    await timed('stop-click', () =>
      page.getByRole('button', { name: 'Stop', exact: true }).click(),
    );
    await timed('play-button-after-stop', () =>
      page.getByRole('button', { name: 'Play', exact: true }).waitFor({ timeout: 0 }),
    );
    await timed('swap-away', () => choose(id === 'band' ? 'loom' : 'band'));
    await timed('swap-back', () => choose(id));
    await timed('theme-click', () =>
      page.getByRole('button', { name: 'Theme riso', exact: true }).click(),
    );
    await timed('theme-attribute', () =>
      expect(page.locator('html')).toHaveAttribute('data-theme', 'riso'),
    );
    // Wait for the new theme to be presented before checking draw errors.
    await presented();
    await ready();
    expect(errors).toEqual([]);
  });
}
