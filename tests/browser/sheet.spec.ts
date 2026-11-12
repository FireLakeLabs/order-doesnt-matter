import { test } from './helpers';
import { expect } from '@playwright/test';
import { fixtures } from '../../src/sheet/fixtures';
import { sheetModel } from '../../src/sheet/model';

test('sheet fixtures: semantics, status labels and phone containment', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', (request) => errors.push(request.url()));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });

  for (const [name, fixture] of Object.entries(fixtures)) {
    const model = sheetModel(fixture);
    await page.setViewportSize({ width: 1440, height: 900 });
    // Keep the browser's JSON-fetch/mount seam while model construction is
    // proved in Node. The other fixtures retain the ordinary harness path.
    if (name === 'trio') {
      await page.route(
        (url) => url.pathname === '/sheet-model.json',
        (route) => route.fulfill({ json: model }),
      );
      await page.goto('/harness/sheet.html?model=/sheet-model.json');
    } else await page.goto(`/harness/sheet.html?fixture=${name}`);
    await expect(page.getByRole('region', { name: 'Score sheet', exact: true })).toBeVisible();
    for (const row of model.rows)
      await expect(page.getByRole('rowheader').filter({ hasText: row.name })).toBeVisible();
    for (const column of model.columns)
      await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    if (name === 'missing') await expect(page.getByText('paper: missing')).toBeVisible();
    if (name === 'broken')
      await expect(
        page.getByText('Broken: Cannot query custom rewrite', { exact: true }).first(),
      ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (name === 'trio') {
      await page
        .getByRole('region', { name: 'Score table, scroll for more settings' })
        .evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }
  expect(errors).toEqual([]);
});

test('moving the playhead preserves table nodes, focus and scroll; constants draw once', async ({
  page,
}) => {
  await page.goto('/harness/sheet.html?fixture=trio');
  await expect(page.locator('h1')).toHaveCount(0);
  await expect(page.getByText('Author name', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Generated name', { exact: true })).toHaveCount(0);
  await expect(page.locator('tbody tr').first().locator('.sheet-constant svg')).toHaveCount(0);
  await page.getByRole('region', { name: 'Score table, scroll for more settings' }).focus();
  const result = await page.evaluate(() => {
    const table = document.querySelector('table');
    const scroller = table!.parentElement!;
    scroller.scrollLeft = 100;
    const before = scroller.scrollLeft;
    const focus = document.activeElement;
    const head = window as unknown as { setSheetPlayhead(x: number | null): void };
    const mutations: string[] = [];
    const observer = new MutationObserver(() => {});
    observer.observe(document.querySelector('main')!, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    head.setSheetPlayhead(75);
    for (const record of observer.takeRecords())
      if (!(record.target as Element).classList.contains('sheet-playhead'))
        mutations.push(record.type);
    const path = document.querySelector('.sheet-playhead')!.getAttribute('d');
    head.setSheetPlayhead(null);
    const hidden = Array.from(document.querySelectorAll<SVGElement>('.sheet-playhead')).every(
      (mark) => mark.style.display === 'none',
    );
    observer.disconnect();
    return {
      sameTable: table === document.querySelector('table'),
      sameScroll: before === scroller.scrollLeft,
      sameFocus: focus === document.activeElement,
      path,
      hidden,
      mutations,
    };
  });
  expect(result).toEqual({
    sameTable: true,
    sameScroll: true,
    sameFocus: true,
    path: 'M75,0 V36',
    hidden: true,
    mutations: [],
  });
});
