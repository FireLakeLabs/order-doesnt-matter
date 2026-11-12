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
