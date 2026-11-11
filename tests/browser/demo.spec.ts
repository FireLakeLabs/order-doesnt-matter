import { readFile, mkdir, rename } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type {} from '../../src/app/main';

test('record local arranged demo (video has no audio)', async ({ browser, request }) => {
  test.skip(process.env.ODM_BROWSER_MODE !== 'demo', 'Local recording only: npm run demo');
  test.skip(!!process.env.CI, 'Local uncommitted demo only');
  let online = false;
  try {
    online = (
      await request.get(
        'https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json',
        { timeout: 6500 },
      )
    ).ok();
  } catch {
    /* record offline, with honest missing states */
  }
  console.log(
    `DEMO: ${online ? 'online' : 'offline'}; Playwright video has no audio. Outputs: test-results/demo/`,
  );
  await mkdir('test-results/demo', { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1360, height: 950 },
    recordVideo: { dir: 'test-results/demo', size: { width: 1360, height: 950 } },
    baseURL: process.env.ODM_URL,
  });
  const page = await context.newPage();
  if (!online)
    await page.route(
      (url) => url.protocol === 'https:',
      (route) => route.abort('internetdisconnected'),
    );
  try {
    await page.goto('/?inspect');
    // Exercise opening the panel rather than depending on its initial visibility.
    await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
    await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
    await page
      .getByLabel('Your Strudel program')
      .fill(await readFile('corpus/programs/real-house-arranged.strudel', 'utf8'));
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
    await expect(page.getByRole('rowheader')).toHaveCount(8);
    await expect(page.getByRole('rowheader').first()).not.toContainText('Not queried');
    await page.screenshot({ path: 'test-results/demo/loaded-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(
        () => page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'trigger').length),
        { timeout: 20000 },
      )
      .toBeGreaterThan(3);
    await page.waitForTimeout(3200);
    await page.screenshot({ path: 'test-results/demo/playing-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'drop', exact: true }).first().click();
    await expect(page.locator('#window')).toHaveText('Cycles 8–16');
    await page.waitForTimeout(700);
    await page.screenshot({ path: 'test-results/demo/selected-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    // Record actual phone viewports. Full-page captures can omit offscreen sticky
    // table headers in Chromium, even though they paint correctly when scrolled.
    await page.screenshot({ path: 'test-results/demo/selected-phone.png' });
    await page.getByRole('rowheader').filter({ hasText: 'chords' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'test-results/demo/selected-phone-rows.png' });
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    console.log(
      'DEMO SOUND STATES',
      JSON.stringify(await page.evaluate(() => window.odmApp.engine!.sounds())),
    );
  } finally {
    await context.close();
    await rename(await page.video()!.path(), 'test-results/demo/demo.webm');
  }
});
