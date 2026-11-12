import { mkdir, readFile, rename } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type {} from '../../src/app/main';
test('record real house constant edit and undo (video has no audio)', async ({ browser }) => {
  test.skip(process.env.ODM_BROWSER_MODE !== 'edit-demo', 'Local recording: npm run demo:edit');
  test.skip(!!process.env.CI, 'Uncommitted local recording only');
  await mkdir('test-results/edit-demo', { recursive: true });
  const context = await browser.newContext({
    baseURL: process.env.ODM_URL,
    viewport: { width: 1360, height: 950 },
    recordVideo: { dir: 'test-results/edit-demo', size: { width: 1360, height: 950 } },
  });
  const page = await context.newPage();
  await page.route(
    (url) => url.protocol === 'https:',
    (route) => route.abort('internetdisconnected'),
  );
  try {
    await page.goto('/?inspect');
    await page
      .getByLabel('Your Strudel program')
      .fill(await readFile('corpus/programs/real-house-arranged.strudel', 'utf8'));
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => Object.keys(window.odmApp.state.events).length))
      .toBe(8);
    await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
    await page.getByRole('button', { name: 'drop', exact: true }).first().click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'swapped').length),
      )
      .toBeGreaterThan(0);
    await page
      .getByRole('row')
      .filter({
        has: page
          .getByRole('rowheader')
          .filter({ has: page.locator('strong', { hasText: /^bass$/ }) }),
      })
      .locator('[data-control="lpf"]')
      .click();
    await expect(page.locator('#editor-breadcrumb')).toHaveText('bass › lpf');
    await page.evaluate(() => {
      const states: string[] = [];
      window.odmApp.subscribe(() => {
        const entry = Object.values(window.odmApp.editor!.state.entries)[0];
        states.push(entry?.status ?? 'clear');
      });
      Object.defineProperty(window, 'editDemoStates', { value: states });
    });
    await page.screenshot({ path: 'test-results/edit-demo/desktop.png' });
    const box = (await page.getByRole('slider').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 18; i++) {
      await page.mouse.move(box.x + box.width * (0.45 + i * 0.012), box.y + box.height / 2);
      await page.waitForTimeout(45);
    }
    await page.screenshot({ path: 'test-results/edit-demo/drag-desktop.png' });
    await page.mouse.up();
    await expect(page.locator('#editor-status')).toHaveText('Heard by the engine');
    await page.screenshot({ path: 'test-results/edit-demo/heard-desktop.png' });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByRole('spinbutton')).toHaveValue('450');
    await expect(page.locator('#editor-status')).toHaveText('Heard by the engine');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'test-results/edit-demo/phone.png' });
    expect(
      await page.evaluate(() => (window as unknown as { editDemoStates: string[] }).editDemoStates),
    ).toContain('pending');
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
  } finally {
    await context.close();
    await rename(await page.video()!.path(), 'test-results/edit-demo/demo.webm');
  }
  console.log('EDIT DEMO: sample hosts blocked; video has no audio; test-results/edit-demo/');
});
