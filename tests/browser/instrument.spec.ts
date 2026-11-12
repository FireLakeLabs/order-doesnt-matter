import { openProgram, play, selectNode, swap, appSignal } from './helpers';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
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
test('real house: mute and unmute kick preserve other instruments', async ({ page }) => {
  await house(page);
  await play(page);
  await swap(page, () => page.getByRole('button', { name: 'Mute kick', exact: true }).click());
  expect(
    await observed(page, async () => [...new Set((await sinceSwap(page)).map((v) => v.s))].sort()),
  ).toEqual(['cp', 'hh', 'oh', 'piano', 'sawtooth']);
  expect((await sinceSwap(page)).some((v) => v.s === 'bd')).toBe(false);
  await swap(page, () => page.getByRole('button', { name: 'Unmute kick', exact: true }).click());
  expect(await observed(page, async () => (await sinceSwap(page)).some((v) => v.s === 'bd'))).toBe(
    true,
  );
});
test('real house: section mute leaves the drop playing', async ({ page }) => {
  const ids = await house(page, 30);
  await page.getByRole('button', { name: 'intro', exact: true }).click();
  await play(page);
  await selectNode(page, { nodeId: ids.chords });
  await expect(page.locator('#editor')).toContainText('piano: missing');
  await swap(page, () =>
    page.getByRole('checkbox', { name: 'Plays in intro', exact: true }).click(),
  );
  expect(await observed(page, async () => (await sinceSwap(page)).length)).toBeGreaterThan(2);
  expect((await sinceSwap(page)).some((v) => v.s === 'piano')).toBe(false);
  // Restart at the drop through the public transport to avoid waiting through the intro.
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  await play(page);
  expect(
    await observed(page, async () => (await sinceSwap(page)).some((v) => v.s === 'piano')),
  ).toBe(true);
});
async function soloHistory(page: Page) {
  const ids = await house(page, 60);
  // Build the same three-edit undo history while stopped. The dedicated mute
  // tests above exercise their live swaps; this case owns solo persistence.
  await page.getByRole('button', { name: 'Mute kick', exact: true }).click();
  await page.getByRole('button', { name: 'Unmute kick', exact: true }).click();
  await page.getByRole('button', { name: 'intro', exact: true }).click();
  await selectNode(page, { nodeId: ids.chords });
  await page.getByRole('checkbox', { name: 'Plays in intro', exact: true }).click();
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  await page.keyboard.press('Escape');
  await selectNode(page, { nodeId: ids.bass });
  await play(page);
  await expect(page.locator('#editor')).toContainText('sawtooth: ready');
  await swap(page, () => page.getByRole('checkbox', { name: 'Solo', exact: true }).press('Space'));
  await expect(page.locator('#solo-banner')).toHaveText('Solo: bass — Stop solo');
}
test('real house: solo survives keyboard name editing and undo', async ({ page }) => {
  await soloHistory(page);
  expect(await observed(page, async () => (await sinceSwap(page)).length)).toBeGreaterThan(2);
  expect((await sinceSwap(page)).every((v) => v.s === 'sawtooth')).toBe(true);
  const liveName = page.getByRole('textbox', { name: 'Instrument name', exact: true });
  await liveName.fill('Solo bass');
  await swap(page, () => liveName.press('Enter'));
  await expect(page.locator('#solo-banner')).toContainText('Solo: Solo bass');
  await swap(page, () => page.getByRole('button', { name: 'Undo', exact: true }).click());
  expect(await observed(page, async () => (await sinceSwap(page)).length)).toBeGreaterThan(2);
  expect((await sinceSwap(page)).every((v) => v.s === 'sawtooth')).toBe(true);
});
test('real house: solo survives undoing section and definition mute', async ({ page }) => {
  await soloHistory(page);
  // Undo the section mute while solo stays selected; edits and undo both retain solo.
  await swap(page, () => page.getByRole('button', { name: 'Undo', exact: true }).click());
  await expect(page.locator('#solo-banner')).toBeVisible();
  expect(await observed(page, async () => (await sinceSwap(page)).length)).toBeGreaterThan(2);
  expect((await sinceSwap(page)).every((v) => v.s === 'sawtooth')).toBe(true);
  await swap(page, () => page.getByRole('button', { name: 'Undo', exact: true }).click());
  expect(
    await page.evaluate(() => window.odmApp.state.rows.find((r) => r.name === 'kick')!.muted),
  ).toBe(true);
  await expect(page.locator('#solo-banner')).toBeVisible();
  await swap(page, () => page.getByRole('button', { name: 'Redo', exact: true }).click());
  await expect(page.locator('#solo-banner')).toBeVisible();
});
test('real house: stopping and restarting solo then releasing restores all instruments', async ({
  page,
}) => {
  await soloHistory(page);
  // Rewind through the public transport so this assertion observes the drop,
  // even if preceding edits consumed the rest of its eight-cycle span.
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  await play(page);
  await swap(page, () => page.getByRole('button', { name: 'Stop solo', exact: true }).click());
  const afterSolo = await observed(
    page,
    async () => new Set((await sinceSwap(page)).map((v) => v.s)),
  );
  expect(afterSolo.size).toBe(6);
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
  await page.screenshot({ path: 'test-results/instrument-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('checkbox', { name: 'Mute everywhere', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await page.locator('#editor button').all())
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/instrument-phone.png' });
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
  await page.setViewportSize({ width: 390, height: 844 });
  const button = page.locator('.sheet-mute');
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.press('Space');
  await expect(page.locator('tbody tr')).toHaveAttribute('data-muted', 'true');
  await expect(button).toBeFocused();
  await expect(page.locator('#editor')).toBeHidden();
});
