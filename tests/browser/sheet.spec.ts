import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { fixtures } from '../../src/sheet/fixtures';
import { sheetModel } from '../../src/sheet/model';

test('sheet fixtures: semantics, status labels, phone containment and screenshots', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', (request) => errors.push(request.url()));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await mkdir('test-results/sheet', { recursive: true });
  for (const [name, fixture] of Object.entries(fixtures)) {
    const model = sheetModel(fixture);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/harness/sheet.html?fixture=${name}`);
    await expect(page.getByRole('region', { name: 'Score sheet', exact: true })).toBeVisible();
    for (const row of model.rows)
      await expect(page.getByRole('rowheader').filter({ hasText: row.name })).toBeVisible();
    for (const column of model.columns)
      await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    if (name === 'missing')
      await expect(
        page.getByText('paper: missing — Sample collection is unavailable'),
      ).toBeVisible();
    if (name === 'broken')
      await expect(
        page.getByText('Broken: Cannot query custom rewrite', { exact: true }).first(),
      ).toBeVisible();
    await page.screenshot({ path: `test-results/sheet/${name}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `test-results/sheet/${name}-phone.png`, fullPage: true });
    if (name === 'trio') {
      await page
        .getByRole('region', { name: 'Score table, scroll for more settings' })
        .evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
      await page.screenshot({ path: 'test-results/sheet/trio-rewrites-phone.png', fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({
        path: 'test-results/sheet/trio-rewrites-desktop.png',
        fullPage: true,
      });
    }
  }
  expect(errors).toEqual([]);
});
