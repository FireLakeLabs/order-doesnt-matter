import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { instruments, walk, type Setting } from '../../src/document';
import { describeTarget } from '../../src/document/edit';
import { generate } from '../../src/generate';
import { queryEventsNode } from '../../src/strudel/evaluate-node';
import { openProgram, play, selectNode, waitForPending, triggerValues } from './helpers';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
test('real house signal: bounds, shape, period, trigger values, undo, keyboard and phone', async ({
  page,
}) => {
  const started = Date.now();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProgram(page, { path: 'corpus/programs/real-house-arranged.strudel' });
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
  const low = page.getByLabel('Low bound · ×', { exact: true }),
    high = page.getByLabel('High bound · ×', { exact: true });
  await expect(low).toHaveValue('0.1');
  await expect(high).toHaveValue('0.35');
  await expect(
    page
      .getByRole('img', { name: 'Real setting values over the current window' })
      .locator('polyline'),
  ).not.toHaveAttribute('points', '');
  await play(page);
  await high.fill('0.6');
  await high.press('Enter');
  await waitForPending(page);
  await expect
    .poll(
      async () =>
        (await triggerValues(page)).filter(
          (v) =>
            (v as { s?: string; gain?: number }).s === 'hh' && (v as { gain: number }).gain > 0.35,
        ).length,
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.locator('.signal-editor summary').click();
  await page.getByRole('button', { name: 'saw', exact: true }).press('Enter');
  const period = page.getByLabel('One sweep every N cycles', { exact: true });
  await period.fill('2');
  await period.press('Enter');
  await waitForPending(page);
  const marker = await page.evaluate(() => window.odmApp.history.length);
  await play(page);
  const cycle = 8;
  await expect
    .poll(
      () =>
        page.evaluate(
          (c) =>
            window.odmApp.history.filter((e) => e.type === 'trigger' && e.cycle >= c + 2).length,
          cycle,
        ),
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
  const actual = await page.evaluate(
    ({ c, marker }) =>
      window.odmApp.history
        .slice(marker)
        .filter((e) => e.type === 'trigger' && e.cycle >= c && e.cycle < c + 2),
    { c: cycle, marker },
  );
  const gains = actual
    .filter((e) => e.type === 'trigger' && (e.value as { s: string }).s === 'hh')
    .map((e) => (e.type === 'trigger' ? (e.value as { gain: number }).gain : NaN));
  expect(gains.length).toBe(32);
  expect(gains.every((v, i) => v >= 0.1 && v <= 0.6 && (i === 0 || v > gains[i - 1]))).toBe(true);
  const baseline = await queryEventsNode(generate(original), cycle, cycle + 2);
  expect(baseline.error).toBeNull();
  const stable = (x: unknown): string =>
    Array.isArray(x)
      ? `[${x.map(stable)}]`
      : x && typeof x === 'object'
        ? `{${Object.entries(x)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}:${stable(v)}`)}}`
        : JSON.stringify(x);
  expect(
    actual
      .filter((e) => e.type === 'trigger' && (e.value as { s: string }).s !== 'hh')
      .map((e) => (e.type === 'trigger' ? stable(e.value) : ''))
      .sort(),
  ).toEqual(
    baseline.events
      .filter((e) => e.hasOnset && (e.value as { s: string }).s !== 'hh')
      .map((e) => stable(e.value))
      .sort(),
  );
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Undo', exact: true }).click();
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
  const handle = page.getByRole('button', { name: 'Drag high bound', exact: true });
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
  await mkdir('test-results', { recursive: true });
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          window.odmApp.state.events[id]?.events
            .filter((e) => e.part[0] >= 8 && e.part[0] < 10)
            .map((e) => e.value),
        hats.id,
      ),
    )
    .toEqual(
      baseline.events.filter((e) => (e.value as { s: string }).s === 'hh').map((e) => e.value),
    );
  await page.locator('#editor').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.locator('.signal-editor').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: 'test-results/signal-desktop.png' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(target).toBeFocused();
  await target.press('Enter');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await handle.evaluate((e) => ({
      w: e.getBoundingClientRect().width,
      h: e.getBoundingClientRect().height,
    })),
  ).toEqual({ w: 44, h: 44 });
  await page.screenshot({ path: 'test-results/signal-phone.png' });
  await page.keyboard.press('Escape');
  await expect(target).toBeFocused();
  console.log(
    `Signal editor measured: ${Date.now() - started} ms; 32 rising trigger values over two cycles`,
  );
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
