import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openProgram, play, selectNode, signal, waitForPending, triggerValues } from './helpers';
import { instruments } from '../../src/document';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

test('source applies once, confirms trigger values, preserves refused text and reverts', async ({
  page,
}) => {
  await openProgram(page, { example: 'Kiln' });
  await page.getByRole('button', { name: 'Section 2', exact: true }).first().click();
  await play(page);
  const origin = await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  await page.getByRole('button', { name: 'Edit as source', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Source text', exact: true });
  const old = await field.inputValue();
  await field.fill(old.replace(/\d+(?:\.\d+)?/, '900'));
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('#editor')).toContainText('Applied.');
  await waitForPending(page);
  await signal(async () =>
    (await triggerValues(page)).some((v) => (v as { cutoff?: number }).cutoff === 900),
  ).toBe(true);
  await field.fill('.lpf(');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(field).toHaveValue('.lpf(');
  await expect(page.locator('#editor [role="alert"]:visible')).toContainText(
    'Check the source text',
  );
  await page.getByRole('button', { name: 'Revert', exact: true }).click();
  await expect(field).toHaveValue('.cutoff(900)');
  await page.keyboard.press('Escape');
  await expect(origin).toBeFocused();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

test('phone source escape hatch supports keyboard, Done and an unclipped panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProgram(page, { source: 'note("c4 e4").s("sine").chop(8)' });
  const doc = await page.evaluate(() => window.odmApp.state.doc!);
  const layer = instruments(doc)[0].pattern.layers.find((l) => l.kind === 'rewrite')!;
  const origin = await selectNode(page, { nodeId: layer.id });
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'generic');
  await expect(page.getByRole('spinbutton', { name: 'Argument 1' })).toHaveValue('8');
  await page.getByRole('button', { name: 'Edit as source', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Source text', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await page.locator('#editor button:visible').all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(origin).toBeFocused();
});

test('real piece source screenshots', async ({ page }) => {
  test.skip(process.env.ODM_SOURCE_SHOTS !== '1', 'Opt-in visual inspection only.');
  await openProgram(page, { path: 'corpus/programs/real-house-arranged.strudel' });
  await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  await page.getByRole('button', { name: 'Edit as source', exact: true }).click();
  await mkdir('test-results/source', { recursive: true });
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.screenshot({ path: `test-results/source/house-${size.width}.png` });
  }
});
