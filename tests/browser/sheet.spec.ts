import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { fixtures } from '../../src/sheet/fixtures';
import { instruments } from '../../src/document';
import { queryEventsNode } from '../../src/strudel/evaluate-node';
import type { Generate, ImportStrudel, SheetInput } from '../../src/contract';
import { build } from 'vite';
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

test('moving the playhead preserves table nodes, focus and scroll; constants draw once', async ({
  page,
}) => {
  await page.goto('/harness/sheet.html?fixture=trio');
  await expect(page.locator('h1')).toHaveCount(0);
  await expect(page.getByText('Author name', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Generated name', { exact: true })).toHaveCount(1);
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

test('real-house-arranged: Node import → instruments → generate(only) → events → model JSON → built harness', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const source = await readFile('corpus/programs/real-house-arranged.strudel', 'utf8');
  // Use the same browser resolver as the existing corpus bundling canary.
  // Native Node resolves Kabelsalat's unused REPL import to its incomplete entry.
  const bundle = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: new URL('../corpus/browser.ts', import.meta.url).pathname, formats: ['es'] },
    },
  });
  const result = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in result)) throw Error('Unexpected bundle watcher');
  const output = result.output.find((chunk) => chunk.type === 'chunk');
  if (!output || output.type !== 'chunk') throw Error('Missing corpus bundle');
  const { importStrudel, generate } = (await import(
    `data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`
  )) as { importStrudel: ImportStrudel; generate: Generate };
  const doc = importStrudel(source).doc;
  const events: SheetInput['events'] = {};
  for (const row of instruments(doc)) {
    events[row.id] = await queryEventsNode(generate(doc, { only: row.id }), 0, 28);
    expect(events[row.id].error).toBeNull();
  }
  const model = sheetModel({ doc, events, fromCycle: 0, toCycle: 28, playhead: 9, sounds: [] });
  await mkdir('test-results/sheet', { recursive: true });
  const path = 'test-results/sheet/real-house-arranged-model.json';
  await writeFile(path, JSON.stringify(model));
  await page.route(
    (url) => url.pathname === '/sheet-model.json',
    (route) => route.fulfill({ path, contentType: 'application/json' }),
  );
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto('/harness/sheet.html?model=/sheet-model.json');
  await page.waitForSelector('tbody').catch(() => {
    throw Error(`Sheet failed: ${errors.join('; ')}`);
  });
  expect(errors).toEqual([]);
  await expect(page.getByRole('rowheader')).toHaveCount(8);
  await expect(page.getByText('in intro: lpf 600', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/sheet/real-house-arranged-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // Chromium can omit offscreen sticky-cell text in a full-page capture after
  // resizing. Paint the full height while retaining the real phone CSS width.
  await page.setViewportSize({
    width: 390,
    height: await page.evaluate(() => document.documentElement.scrollHeight),
  });
  await page.screenshot({
    path: 'test-results/sheet/real-house-arranged-phone.png',
    fullPage: true,
  });
});
