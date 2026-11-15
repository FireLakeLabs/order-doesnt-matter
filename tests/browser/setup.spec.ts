import { expect } from '@playwright/test';
import { test, openProgram, selectNode, waitForPending } from './helpers';

test('pasted setup opens as source and applies an edit', async ({ page }) => {
  await openProgram(page, { source: 'samples({ kick: "kick.wav" }); note(60)' });
  const setup = page.locator('.sheet-setup');
  await expect(setup).not.toHaveAttribute('open');
  await setup.locator('summary').click();
  await selectNode(page, { breadcrumb: ['setup', 'Loads sounds from a sample map'] });
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'source');
  const field = page.getByRole('textbox', { name: 'Source text', exact: true });
  await expect(field).toHaveValue(/kick\.wav/);
  await field.fill('samples({ kick: "new-kick.wav" });');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('#editor')).toContainText('Applied.');
  await waitForPending(page);
  expect(await page.evaluate(() => window.odmApp.state.doc!.body[0])).toMatchObject({
    kind: 'setup',
    code: 'samples({ kick: "new-kick.wav" });',
  });
  await expect(setup).toHaveAttribute('open');
});

test('comment-prefixed whole-program setup has a meaningful label and exact source Apply/Undo on phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 });
  const source =
    '// Original helper study\nfunction accent(p) { return p.gain(.5); }\naccent(s("bd"))';
  await openProgram(page, { source });
  const setup = page.locator('.sheet-setup');
  await setup.locator('summary').click();
  await selectNode(page, { breadcrumb: ['setup', 'Defines helper: accent'] });
  const field = page.getByRole('textbox', { name: 'Source text', exact: true });
  await expect(field).toHaveValue(source);
  const original = await page.evaluate(() => window.odmApp.state.doc);
  const edited = source.replace('.5', '.25');
  await field.fill(edited);
  await page.getByRole('button', { name: 'Apply', exact: true }).press('Enter');
  await expect(page.locator('#editor')).toContainText('Applied.');
  await waitForPending(page);
  expect(await page.evaluate(() => window.odmApp.state.doc!.body[0])).toHaveProperty(
    'code',
    edited,
  );
  await page.locator('#undo').click();
  await waitForPending(page);
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(original);
  await page.getByRole('button', { name: 'Revert', exact: true }).click();
  await expect(field).toHaveValue(source);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
