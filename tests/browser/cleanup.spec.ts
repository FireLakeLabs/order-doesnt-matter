import { test } from './helpers';
import { scoreReady, play } from './helpers';
import { expect } from '@playwright/test';
import type {} from '../../src/app/main';

test('sit-out rows, sticky headings, late sounds and phone toolbar', async ({ page }) => {
  await page.route(
    (url) => url.protocol === 'https:',
    (route) => route.abort('internetdisconnected'),
  );
  await page.goto('/?inspect');
  await page
    .getByLabel('Your Strudel program')
    .fill('const bass=note(60).s("sine").lpf(450); arrange([20,s("triangle")],[4,bass])');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await scoreReady(page);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  const bass = page
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader').filter({ hasText: 'bass' }) });
  await expect(bass).toHaveClass('sheet-sit-out');
  await expect(bass.getByRole('rowheader')).toContainText('not in this section');
  for (const cell of await bass.locator('td').all()) await expect(cell).toBeEmpty();

  await page.setViewportSize({ width: 390, height: 844 });
  const toolbar = await page
    .locator('#undo, #redo, #paste')
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().top));
  expect(new Set(toolbar).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await play(page);
  await expect(bass.getByRole('rowheader')).toContainText('sine: ready');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Kiln', exact: true }).click();
  await scoreReady(page);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  await scoreReady(page);
  await bass.locator('[data-control="lpf"]').click();
  const scroll = page.getByRole('region', { name: 'Score table, scroll for more settings' });
  await scroll.evaluate((el) => {
    el.scrollTop = 200;
  });
  expect(await scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const header = scroll.getByRole('columnheader', { name: 'lpf', exact: true });
  expect(await header.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
  await page.setViewportSize({ width: 390, height: 844 });
});

test('sounds beyond the discovery cap say not used yet only during playback', async ({ page }) => {
  await page.route(
    (url) => url.protocol === 'https:',
    (route) => route.abort('internetdisconnected'),
  );
  await page.goto('/?inspect');
  const sections = Array.from({ length: 32 }, () => '[4,early]').join(',');
  await page
    .getByLabel('Your Strudel program')
    .fill(
      `const early=s("triangle"); const late=note(60).s("sine"); arrange(${sections},[4,late])`,
    );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  const late = page.getByRole('rowheader').filter({ hasText: 'late' });
  await expect(late).toContainText('sine: not loaded yet');
  await scoreReady(page);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await play(page);
  await expect(late).toContainText('sine: not used yet');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(late).toContainText('sine: not loaded yet');
});
