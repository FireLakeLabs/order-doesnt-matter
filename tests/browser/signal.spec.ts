import { test } from './helpers';
import {
  signal,
  openProgram,
  play,
  selectNode,
  waitForPending,
  triggerValues,
  sharedProgram,
} from './helpers';
import { expect, type Page } from '@playwright/test';
import { instruments, walk, type Setting } from '../../src/document';
import { describeTarget } from '../../src/document/edit';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
async function houseSignal(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  const original = await page.evaluate(() => window.odmApp.state.doc!);
  const hats = instruments(original).find((r) => r.name === 'percussion · hh')!;
  let id = '';
  walk(original, (n) => {
    if (
      'value' in n &&
      'name' in n &&
      (n as Setting).name === 'gain' &&
      describeTarget(original, n.id).instrumentId === hats.id
    )
      id = n.id;
  });
  const target = await selectNode(page, { nodeId: id });
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'signal');
  await expect(page.locator('#editor-breadcrumb')).toHaveText(
    'percussion · hh › gain (generated name)',
  );
  const low = page.getByLabel('Low bound', { exact: true }),
    high = page.getByLabel('High bound', { exact: true });
  await expect(low).toHaveValue('0.1');
  await expect(high).toHaveValue('0.35');
  await expect(
    page
      .getByRole('img', { name: 'Real setting values over the current window' })
      .locator('polyline'),
  ).not.toHaveAttribute('points', '');
  return { original, hats, target, low, high };
}
test.describe('real house signal with shared setup', () => {
  sharedProgram((page) =>
    openProgram(page, { path: 'corpus/programs/real-house-arranged.strudel' }),
  );
  test('real house signal: high bound changes carrying trigger values', async ({ page }) => {
    const { high } = await houseSignal(page);
    await play(page);
    await high.fill('0.6');
    await high.press('Enter');
    await waitForPending(page);
    await signal(
      async () =>
        (await triggerValues(page)).filter(
          (v) =>
            (v as { s?: string; gain?: number }).s === 'hh' && (v as { gain: number }).gain > 0.35,
        ).length,
    ).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
  });
  async function shapeAndPeriod(page: Page) {
    const setup = await houseSignal(page);
    await setup.high.fill('0.6');
    await setup.high.press('Enter');
    await page.locator('.signal-editor summary').click();
    await page.getByRole('button', { name: 'saw', exact: true }).press('Enter');
    const period = page.getByLabel('One sweep every N cycles', { exact: true });
    await period.fill('2');
    await period.press('Enter');
    await waitForPending(page);
    return { ...setup, period };
  }
  test('real house signal: undo, keyboard, drag, focus and phone', async ({ page }) => {
    const { target, low, high, period } = await shapeAndPeriod(page);
    for (let i = 0; i < 3; i++)
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(high).toHaveValue('0.35');
    await expect(low).toHaveValue('0.1');
    await expect(page.getByRole('button', { name: 'perlin', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await period.fill('1/2');
    await period.press('Enter');
    await expect(period).toHaveValue('0.5');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    const handle = page.getByRole('slider', { name: 'High bound slider', exact: true });
    await handle.press('ArrowRight');
    await expect(high).toHaveValue('0.36');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    const box = await handle.boundingBox();
    await page.mouse.move(box!.x + 22, box!.y + 22);
    await page.mouse.down();
    await page.mouse.move(box!.x + 42, box!.y + 22, { steps: 3 });
    await page.mouse.up();
    await expect(high).not.toHaveValue('0.35');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(high).toHaveValue('0.35');
    await page.locator('.signal-editor summary').click();

    await page.locator('#editor').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.locator('.signal-editor').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(target).toBeFocused();
    await target.press('Enter');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await handle.evaluate((e) => ({
        w: e.getBoundingClientRect().width,
        h: e.getBoundingClientRect().height,
      })),
    ).toEqual({ w: 44, h: 44 });
    await page.keyboard.press('Escape');
    await expect(target).toBeFocused();
  });
});
test('a reused signal still shows its real values and explains why its controls are read only', async ({
  page,
}) => {
  await openProgram(page, { source: 'const driver=sine.range(200,4000); s("hh*4").lpf(driver)' });
  await selectNode(page, { breadcrumb: ['Instrument 1', 'lpf'] });
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'signal');
  await expect(page.getByRole('alert')).toContainText('reused or takes arguments');
  await expect(page.locator('.signal-fields')).toBeHidden();
  await expect(
    page
      .getByRole('img', { name: 'Real setting values over the current window' })
      .locator('polyline'),
  ).not.toHaveAttribute('points', '');
});
