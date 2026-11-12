import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type {} from '../../src/app/main';
test('20 serial edits: input event → swapped trigger scheduled audio time', async ({
  page,
  browser,
}) => {
  test.skip(process.env.ODM_BROWSER_MODE !== 'measure', 'Local measurement: npm run measure:edit');
  await page.route(
    (url) => url.protocol === 'https:',
    (route) => route.abort('internetdisconnected'),
  );
  await page.goto('/?inspect');
  await page.getByRole('button', { name: 'Kiln', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'swapped').length),
    )
    .toBeGreaterThan(0);
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader').filter({ hasText: 'bass' }) })
    .locator('[data-control="lpf"]')
    .click();
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    samples.push(
      await page.getByRole('slider').evaluate(
        (element, position) =>
          new Promise<number>((resolve) => {
            const engine = window.odmApp.engine!;
            let started = 0;
            const unsubscribe = engine.subscribe((event) => {
              if (event.type === 'swapped') {
                unsubscribe();
                resolve((event.time - started) * 1000);
              }
            });
            element.addEventListener(
              'input',
              () => {
                started = engine.audioTime();
              },
              { once: true, capture: true },
            );
            const input = element as HTMLInputElement;
            input.value = String(position);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }),
        0.3 + i * 0.012,
      ),
    );
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const result = {
    samples,
    edits: samples.length,
    medianMs: (sorted[9] + sorted[10]) / 2,
    p90Ms: sorted[17],
    worstMs: sorted.at(-1),
    browser: browser.version(),
    sampleRate: await page.evaluate(() => window.odmApp.engine!.tap().sampleRate),
    definition:
      'Input event audio clock to swapped.time (scheduled audio clock); one machine, blocked sample hosts. No perception claim.',
  };
  expect(samples).toHaveLength(20);
  expect(samples.every((n) => Number.isFinite(n) && n >= 0)).toBe(true);
  await mkdir('test-results/edit', { recursive: true });
  await writeFile('test-results/edit/measurement.json', JSON.stringify(result, null, 2));
  console.log('EDIT SCHEDULING MEASURED', JSON.stringify(result));
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
