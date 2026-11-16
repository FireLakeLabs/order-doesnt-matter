import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

// Register a view's complete CI browser check with viewSmoke(test, 'loom').
// Pass Playwright's test and the registry id; this covers Canvas 2D and WebGL.
// Extended checks and measurements belong to npm run measure:views, outside CI.
export function viewSmoke(test: typeof import('@playwright/test').test, id: string) {
  test(`${id}: shared Studio smoke`, async ({ page, context }) => {
    const errors: string[] = [];
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
    const ready = () =>
      page.waitForFunction(
        () =>
          document
            .querySelector('[data-region="stage-a"] .view-host')
            ?.getAttribute('data-score-ready') === 'true' &&
          document.querySelector('[data-region="stage-a"] .view-status')?.textContent === '',
        undefined,
        { timeout: 0 },
      );
    const choose = async (view: string) => {
      await stage.getByRole('button', { name: 'Views', exact: true }).click();
      await stage.locator(`.shelf-popover [data-view="${view}"] .view-choice`).click();
      await ready();
      await expect(canvas).toHaveCount(1);
    };
    await page.goto(`/studio.html?a=${encodeURIComponent(id)}`);
    await ready();
    await page.getByRole('button', { name: 'Paste', exact: true }).click();
    await page
      .getByLabel('Strudel program')
      .fill(await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'));
    await page.getByRole('button', { name: 'Import program', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 0 });
    await ready();
    await expect(canvas).toHaveCount(1);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor({ timeout: 0 });
    const before = await canvas.screenshot();
    await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor({ timeout: 0 });
    await choose('test-card');
    await choose(id);
    await page.getByRole('button', { name: 'Theme riso', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'riso');
    await ready();
    expect(errors).toEqual([]);
  });
}
