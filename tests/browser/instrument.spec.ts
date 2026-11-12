import { test } from './helpers';
import { openProgram, play, selectNode, swap, appSignal, scoreReady, signal } from './helpers';
import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
async function observed<T>(page: Page, fn: () => Promise<T>) {
  await appSignal(page, () => {
    const h = window.odmApp.history;
    const index = h.findLastIndex((e) => e.type === 'swapped');
    const b = h[index];
    return (
      b?.type === 'swapped' &&
      h.slice(index + 1).some((e) => e.type === 'trigger' && e.cycle >= Math.ceil(b.cycle) + 1)
    );
  });
  return await fn();
}
// Inspect only triggers beyond the scheduling boundary, excluding already queued notes.
async function sinceSwap(page: Page) {
  return page.evaluate(() => {
    const history = window.odmApp.history;
    const boundary = history.findLast((e) => e.type === 'swapped');
    if (!boundary || boundary.type !== 'swapped') return [];
    return history
      .filter((e) => e.type === 'trigger' && e.time > boundary.time + 0.01)
      .map((e) => (e.type === 'trigger' ? (e.value as { s?: string; cutoff?: number }) : {}));
  });
}
async function house(page: Page, cpm = 90) {
  // The real score is read in place; a test-only tempo shortens scheduling waits.
  await openProgram(page, {
    source: (await readFile('corpus/programs/real-house-arranged.strudel', 'utf8')).replace(
      /setcpm\([^)]*\)/,
      `setcpm(${cpm})`,
    ),
  });
  await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
  const ids = await page.evaluate(() =>
    Object.fromEntries(window.odmApp.state.rows.map((r) => [r.name, r.id])),
  );
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  return ids;
}
test('real house: mute and unmute kick update trigger delivery', async ({ page }) => {
  const ids = await house(page);
  await play(page);
  await swap(page, () => page.getByRole('button', { name: 'Mute kick', exact: true }).click());
  expect(await observed(page, async () => (await sinceSwap(page)).length)).toBeGreaterThan(0);
  expect((await sinceSwap(page)).some((v) => v.s === 'bd')).toBe(false);
  // A full negative observation may consume the drop on a busy CI runner.
  // Rewind while muted so the positive check cannot observe the kickless breakdown.
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  await play(page);
  await swap(page, () => page.getByRole('button', { name: 'Unmute kick', exact: true }).click());
  await signal(async () => (await sinceSwap(page)).some((v) => v.s === 'bd')).toBe(true);
  await selectNode(page, { nodeId: ids.chords });
  await expect(page.locator('#editor')).toContainText('piano: missing');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
test('real house: section mute checkbox follows the pinned section', async ({ page }) => {
  const ids = await house(page);
  await page.getByRole('button', { name: 'intro', exact: true }).click();
  await selectNode(page, { nodeId: ids.chords });
  const check = page.getByRole('checkbox', { name: 'Plays in intro', exact: true });
  await check.click();
  await expect(check).not.toBeChecked();
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  await expect(page.getByRole('checkbox', { name: /^Plays in drop/ }).first()).toBeChecked();
});
async function soloBass(page: Page) {
  const ids = await house(page, 60);
  await selectNode(page, { nodeId: ids.bass });
  await play(page);
  await expect(page.locator('#editor')).toContainText('sawtooth: ready');
  await swap(page, () => page.getByRole('checkbox', { name: 'Solo', exact: true }).press('Space'));
  await expect(page.locator('#solo-banner')).toHaveText('Solo: bass — Stop solo');
}
test('real house: solo survives keyboard name editing and undo', async ({ page }) => {
  await soloBass(page);
  const liveName = page.getByRole('textbox', { name: 'Instrument name', exact: true });
  await liveName.fill('Solo bass');
  await swap(page, () => liveName.press('Enter'));
  await expect(page.locator('#solo-banner')).toContainText('Solo: Solo bass');
  await swap(page, () => page.getByRole('button', { name: 'Undo', exact: true }).click());
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  await play(page);
  await swap(page, () => page.getByRole('button', { name: 'Stop solo', exact: true }).click());
  await expect(page.locator('#solo-banner')).toBeHidden();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
test('real house: keyboard name, phone editor and focus', async ({ page }) => {
  const ids = await house(page);
  await selectNode(page, { nodeId: ids.bass });
  const field = page.getByRole('textbox', { name: 'Instrument name', exact: true });
  await field.fill('kick');
  await field.press('Enter');
  await expect(page.locator('#editor').getByRole('alert')).toContainText('already has that name');
  await field.fill('Low end');
  await field.press('Enter');
  await expect(page.locator('#editor-breadcrumb')).toHaveText('Low end');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('checkbox', { name: 'Mute everywhere', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await page.locator('#editor button').all())
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const header = page.locator(`th[data-editor-target="${ids.bass}"]`);
  await expect(header).toBeFocused();
  await header.press('Enter');
  await page.keyboard.press('Escape');
  await expect(header).toBeFocused();
});
test('stale row mute cannot target another loaded piece; solo clears on load', async ({ page }) => {
  await openProgram(page, { source: 'stack(s("bd"),s("hh"))' });
  const unchanged = await page.evaluate(async () => {
    const stale = document.querySelector<HTMLButtonElement>('.sheet-mute')!;
    const app = window.odmApp;
    app.solo(app.state.rows[0].id);
    await app.load('note(60).s("sine")');
    const doc = JSON.stringify(app.state.doc);
    stale.click();
    return app.state.solo === null && JSON.stringify(app.state.doc) === doc && !app.editor!.canUndo;
  });
  expect(unchanged).toBe(true);
  await expect(page.locator('#solo-banner')).toBeHidden();
  // app.load resolves after preflight; its row queries finish independently.
  await scoreReady(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const button = page.locator('.sheet-mute');
  await expect(button).toBeVisible();
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.press('Space');
  await expect(page.locator('tbody tr')).toHaveAttribute('data-muted', 'true');
  await expect(button).toBeFocused();
  await expect(page.locator('#editor')).toBeHidden();
});
