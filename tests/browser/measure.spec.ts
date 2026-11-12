import { scoreReady, signal } from './helpers';
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
  await scoreReady(page);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await signal(() =>
    page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'swapped').length),
  ).toBeGreaterThan(0);
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader').filter({ hasText: 'bass' }) })
    .locator('[data-control="lpf"]')
    .click();
  const samples: { revisionBoundaryMs: number; ownTriggerMs: number }[] = [];
  for (let i = 0; i < 20; i++) {
    samples.push(
      await page.getByRole('slider').evaluate(
        (element, position) =>
          new Promise<{ revisionBoundaryMs: number; ownTriggerMs: number }>((resolve) => {
            const engine = window.odmApp.engine!;
            const bass = window.odmApp.state.rows.find((r) => r.name === 'bass')!.id;
            const revision =
              window.odmApp.history.findLast((e) => e.type === 'swapped')!.revision + 1;
            let started = 0,
              boundary: number | undefined,
              own: number | undefined;
            const unsubscribe = engine.subscribe((event) => {
              if (event.type === 'swapped' && event.revision === revision)
                boundary = (event.time - started) * 1000;
              if (
                event.type === 'trigger' &&
                event.revision === revision &&
                event.instrument === bass
              )
                own ??= (event.time - started) * 1000;
              if (boundary !== undefined && own !== undefined) {
                unsubscribe();
                resolve({ revisionBoundaryMs: boundary, ownTriggerMs: own });
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
  const stats = (key: keyof (typeof samples)[number]) => {
    const sorted = samples.map((s) => s[key]).sort((a, b) => a - b);
    return { medianMs: (sorted[9] + sorted[10]) / 2, p90Ms: sorted[17], worstMs: sorted.at(-1) };
  };
  const result = {
    samples,
    edits: samples.length,
    revisionBoundary: stats('revisionBoundaryMs'),
    editedInstrument: stats('ownTriggerMs'),
    browser: browser.version(),
    sampleRate: await page.evaluate(() => window.odmApp.engine!.tap().sampleRate),
    definition:
      'Input event audio clock to swapped.time and the edited row identity’s first new-revision trigger.time. Scheduled audio clock, blocked sample hosts; not a speaker measurement.',
  };
  expect(samples).toHaveLength(20);
  expect(
    samples.every(
      (s) =>
        Number.isFinite(s.revisionBoundaryMs) &&
        s.revisionBoundaryMs >= 0 &&
        s.ownTriggerMs >= s.revisionBoundaryMs - 1e-6,
    ),
  ).toBe(true);
  await mkdir('test-results/edit', { recursive: true });
  await writeFile('test-results/edit/measurement.json', JSON.stringify(result, null, 2));
  console.log('EDIT SCHEDULING MEASURED', JSON.stringify(result));
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
