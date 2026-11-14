import { expect } from '@playwright/test';
import { test, openProgram, play, waitForPending, signal, appSignal } from './helpers';
import { callbackPiece } from '../fixtures/callback-rewrite';
const ed = '#editor';

test('Kiln-derived callback: planet navigation, branch factor and order, exact single Undo, confirmed playback', async ({
  page,
}) => {
  await openProgram(page, { source: callbackPiece });
  const original = await page.evaluate(() => window.odmApp.state.doc);
  const bass = await page.evaluate(
    () => window.odmApp.state.rows.find((r) => r.name === 'bass')!.id,
  );
  const origin = page.locator(`[data-live-id="${bass}"]`);
  await origin.press('Enter');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'every', exact: true })
    .press('Enter');
  await page.getByRole('button', { name: 'Open Periodic change · p', exact: true }).press('Enter');
  await expect(page.locator('#editor-breadcrumb')).toHaveText(
    'bass › every › Periodic change · p › Rewrites',
  );
  await page.getByRole('button', { name: 'Edit fast', exact: true }).press('Enter');
  const field = page.getByRole('spinbutton', { name: 'Time factor', exact: true });
  await field.fill('3');
  await field.press('Enter');
  await waitForPending(page);
  await expect(field).toBeFocused();
  await page.locator('#undo').click();
  await waitForPending(page);
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(original);
  await expect(field).toHaveValue('2');
  await page.getByRole('button', { name: 'Move earlier', exact: true }).press('Enter');
  await waitForPending(page);
  await expect(page.getByRole('list', { name: 'Callback rewrites · in order' })).toHaveText(
    'fastrev',
  );
  await expect(page.getByRole('button', { name: 'Move earlier', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Edit fast', exact: true })).toBeFocused();
  await page.locator('#undo').click();
  await waitForPending(page);
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(original);
  await signal(() => page.getByRole('img', { name: 'Without fast' }).isVisible()).toBe(true);
  const figure = await page
    .locator(`${ed} figure`)
    .last()
    .evaluateHandle((n) => n);
  await page.locator(`${ed} figure`).last().scrollIntoViewIfNeeded();
  expect(await figure.evaluate((n) => n.isConnected)).toBe(true);
  await figure.dispose();
  await play(page);
  const revision = await page.evaluate(() => window.odmApp.editor!.state.goodRevision);
  await field.fill('3');
  await field.press('Enter');
  // Pending belongs to bass, and clears only after a trigger carrying that revision.
  await waitForPending(page);
  await appSignal(
    page,
    ({ bass, revision }) =>
      window.odmApp.history.some(
        (e) => e.type === 'trigger' && e.instrument === bass && e.revision > revision,
      ),
    { bass, revision },
  );
  await page.locator('.editor-done').press('Enter');
  await expect(origin).toBeFocused();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.locator('#undo').click();
  await waitForPending(page);
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(original);
});

test('phone callback: enlarged List origin, independent layer siblings, add/remove, source escape and revalidation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await openProgram(page, { source: callbackPiece });
  const original = await page.evaluate(() => window.odmApp.state.doc);
  await page.locator('.live-panel > summary').click();
  const list = page.locator('.live-list-disclosure');
  if (!(await list.evaluate((n) => n.hasAttribute('open')))) await list.locator('summary').click();
  const bass = await page.evaluate(
    () => window.odmApp.state.rows.find((r) => r.name === 'bass')!.id,
  );
  const origin = page.locator(`[data-list-id="${bass}"]`);
  const held = await origin.evaluateHandle((n) => n);
  await page.locator('#now-enlarge').press('Enter');
  await origin.press('Enter');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'layer', exact: true })
    .press('Enter');
  await page.getByRole('button', { name: 'Open Branch 2 · right', exact: true }).press('Enter');
  await expect(page.locator(ed)).toContainText('Shared definitions change at every use');
  await page.getByRole('button', { name: 'Add early', exact: true }).press('Enter');
  await page.getByRole('spinbutton', { name: 'Cycles earlier', exact: true }).fill('.25');
  await page.getByRole('spinbutton', { name: 'Cycles earlier', exact: true }).press('Enter');
  await waitForPending(page);
  await expect(page.getByRole('list', { name: 'Callback rewrites · in order' })).toHaveText(
    'Settings retained · panearly',
  );
  await page.getByRole('button', { name: 'Remove rewrite', exact: true }).press('Enter');
  await waitForPending(page);
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(original);
  await page.getByRole('button', { name: 'Back to layer', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Edit Argument 2 as source', exact: true }).press('Enter');
  const field = page.getByRole('textbox', { name: 'Source text', exact: true });
  await expect(field).toHaveValue('right => right.pan(0.8)');
  await field.fill('right => (');
  await page.getByRole('button', { name: 'Apply', exact: true }).press('Enter');
  await expect(page.locator(`${ed} [role="alert"]:visible`)).toContainText('Check the source text');
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(original);
  await field.fill('right => right.pan(.8).rev()');
  await page.getByRole('button', { name: 'Apply', exact: true }).press('Enter');
  await signal(() => page.getByRole('button', { name: 'Apply', exact: true }).isEnabled()).toBe(
    true,
  );
  await expect(page.locator(ed)).toContainText('Applied.');
  await page.getByRole('button', { name: 'Back to bass', exact: true }).press('Enter');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'layer', exact: true })
    .press('Enter');
  await page.getByRole('button', { name: 'Open Branch 2 · right', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Edit rev', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit as source', exact: true }).press('Enter');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await page.locator(`${ed} button:visible, ${ed} textarea`).all()) {
    await control.scrollIntoViewIfNeeded();
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.locator('.editor-done').focus();
  await page.keyboard.press('Escape');
  await expect(origin).toBeFocused();
  expect(await held.evaluate((n) => document.activeElement === n && n.isConnected)).toBe(true);
  await held.dispose();
  await page.locator('#undo').click();
  await waitForPending(page);
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(original);
});

test('unsafe callback and when predicate remain independently source editable', async ({
  page,
}) => {
  await openProgram(page, {
    source: 'note("fs2 a2").s("triangle").every(3,p=>{return p.rev()}).when("<0 1>",q=>q.fast(2))',
  });
  await page.locator('.sheet-chips [data-editor-target]').first().press('Enter');
  await expect(page.locator(ed)).toContainText('read-only');
  await expect(page.getByRole('button', { name: /Open Periodic change/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit Change as source', exact: true }).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Source text', exact: true })).toHaveValue(
    'p=>{return p.rev()}',
  );
  await page.getByRole('button', { name: /Back to / }).press('Enter');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'when', exact: true })
    .press('Enter');
  await expect(page.locator(ed)).toContainText('Predicate · read-only');
  await expect(page.locator(ed).getByRole('textbox')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Open Conditional change · q', exact: true })
    .press('Enter');
  await page.getByRole('button', { name: 'Edit fast', exact: true }).press('Enter');
  await expect(page.getByRole('spinbutton', { name: 'Time factor', exact: true })).toHaveValue('2');
});

test('unknown callback source fails safely during playback and keeps entered text for repair', async ({
  page,
}) => {
  await openProgram(page, {
    source: 'setcpm(240); const bass=note("fs2 a2").s("triangle").every(3,p=>p.rev()); bass',
  });
  const original = await page.evaluate(() => window.odmApp.state.doc);
  await play(page);
  await page.locator('.sheet-chips [data-editor-target]').first().press('Enter');
  await page.getByRole('button', { name: 'Edit Change as source', exact: true }).press('Enter');
  const field = page.getByRole('textbox', { name: 'Source text', exact: true });
  await field.fill('p=>p.notARealRewrite()');
  await page.getByRole('button', { name: 'Apply', exact: true }).press('Enter');
  await signal(() => page.getByRole('button', { name: 'Apply', exact: true }).isEnabled()).toBe(
    true,
  );
  await appSignal(page, () =>
    Object.values(window.odmApp.editor!.state.entries).some((e) => e.status === 'failed'),
  );
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(original);
  await expect(field).toHaveValue('p=>p.notARealRewrite()');
  await expect(page.locator('#editor-status')).toContainText('Change failed');
  expect(await page.evaluate(() => window.odmApp.state.playing)).toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
