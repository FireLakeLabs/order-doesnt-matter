import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { openProgram, play, selectNode } from './helpers';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
const poll = <T>(fn: () => T | Promise<T>) => expect.poll(fn, { intervals: [50] });
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
async function swap(page: Page, action: () => Promise<unknown>) {
  const count = await page.evaluate(
    () => window.odmApp.history.filter((e) => e.type === 'swapped').length,
  );
  await action();
  await poll(() =>
    page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'swapped').length),
  ).toBeGreaterThan(count);
}
test('real house: mute, use mute, solo, undo and keyboard name; phone editor fits', async ({
  page,
}) => {
  const started = performance.now();
  // The real score is read in place; a test-only tempo shortens scheduling waits.
  await openProgram(page, {
    source: (await readFile('corpus/programs/real-house-arranged.strudel', 'utf8')).replace(
      /setcpm\([^)]*\)/,
      'setcpm(90)',
    ),
  });
  await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
  const ids = await page.evaluate(() =>
    Object.fromEntries(window.odmApp.state.rows.map((r) => [r.name, r.id])),
  );
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  await play(page);
  await swap(page, () => page.getByRole('button', { name: 'Mute kick', exact: true }).click());
  await poll(async () => [...new Set((await sinceSwap(page)).map((v) => v.s))].sort()).toEqual([
    'cp',
    'hh',
    'oh',
    'piano',
    'sawtooth',
  ]);
  expect((await sinceSwap(page)).some((v) => v.s === 'bd')).toBe(false);
  await swap(page, () => page.getByRole('button', { name: 'Unmute kick', exact: true }).click());
  await poll(async () => (await sinceSwap(page)).some((v) => v.s === 'bd')).toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'intro', exact: true }).click();
  await play(page);
  await selectNode(page, { nodeId: ids.chords });
  await expect(page.locator('#editor')).toContainText('piano: missing');
  await swap(page, () => page.getByRole('button', { name: 'Plays in intro', exact: true }).click());
  await poll(async () => (await sinceSwap(page)).length).toBeGreaterThan(2);
  expect((await sinceSwap(page)).some((v) => v.s === 'piano')).toBe(false);
  // Restart at the drop through the public transport to avoid waiting through the intro.
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  await play(page);
  await poll(async () => (await sinceSwap(page)).some((v) => v.s === 'piano')).toBe(true);
  await page.keyboard.press('Escape');
  await selectNode(page, { nodeId: ids.bass });
  await expect(page.locator('#editor')).toContainText('sawtooth: ready');
  await swap(page, () => page.getByRole('button', { name: 'Solo', exact: true }).press('Space'));
  await expect(page.locator('#solo-banner')).toHaveText('Solo: bass — Stop solo');
  await poll(async () => (await sinceSwap(page)).length).toBeGreaterThan(2);
  expect((await sinceSwap(page)).every((v) => v.s === 'sawtooth')).toBe(true);
  const liveName = page.getByRole('textbox', { name: 'Instrument name', exact: true });
  await liveName.fill('Solo bass');
  await swap(page, () => liveName.press('Enter'));
  await expect(page.locator('#solo-banner')).toContainText('Solo: Solo bass');
  await swap(page, () => page.getByRole('button', { name: 'Undo', exact: true }).click());
  // Undo the section mute while solo stays selected; edits and undo both retain solo.
  await swap(page, () => page.getByRole('button', { name: 'Undo', exact: true }).click());
  await expect(page.locator('#solo-banner')).toBeVisible();
  await poll(async () => (await sinceSwap(page)).length).toBeGreaterThan(2);
  expect((await sinceSwap(page)).every((v) => v.s === 'sawtooth')).toBe(true);
  await swap(page, () => page.getByRole('button', { name: 'Undo', exact: true }).click());
  expect(
    await page.evaluate(() => window.odmApp.state.rows.find((r) => r.name === 'kick')!.muted),
  ).toBe(true);
  await expect(page.locator('#solo-banner')).toBeVisible();
  await swap(page, () => page.getByRole('button', { name: 'Redo', exact: true }).click());
  await swap(page, () => page.getByRole('button', { name: 'Stop solo', exact: true }).click());
  await poll(async () => new Set((await sinceSwap(page)).map((v) => v.s)).size).toBe(6);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Instrument name', exact: true });
  await field.fill('kick');
  await field.press('Enter');
  await expect(page.locator('#editor [role="alert"]')).toContainText('already has that name');
  await field.fill('Low end');
  await field.press('Enter');
  await expect(page.locator('#editor-breadcrumb')).toHaveText('Low end');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/instrument-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Mute everywhere', exact: true })).toBeVisible();
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
  console.log(`Instrument workflow: ${((performance.now() - started) / 1000).toFixed(3)} s`);
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
