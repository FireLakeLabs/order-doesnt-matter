import { expect } from '@playwright/test';
import { test, openProgram, selectNode, play, swap, appSignal, signal } from './helpers';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

test('Kiln: live deletion removes row, planet and a full cycle of triggers; Undo restores exactly', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProgram(page, { example: 'Kiln' });
  // Keep the bundled score; a tempo-only history entry shortens observation.
  await page.evaluate(() => {
    const doc = window.odmApp.state.doc!;
    window.odmApp.editor!.apply({
      ...doc,
      body: doc.body.map((n) => (n.kind === 'tempo' ? { ...n, cpm: 480 } : n)),
    });
  });
  await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
  const before = await page.evaluate(() => ({
    doc: window.odmApp.state.doc,
    row: window.odmApp.state.rows[0],
    neighbour: window.odmApp.state.rows[1].id,
  }));
  await play(page);
  await selectNode(page, { nodeId: before.row.id });
  await page.getByRole('button', { name: 'Delete instrument', exact: true }).click();
  await expect(page.locator('#editor')).toContainText(`Delete ${before.row.name}`);
  await expect(page.locator('#editor')).toContainText('It plays in 3 sections.');
  await expect(page.getByRole('button', { name: 'Keep instrument' })).toBeFocused();
  if (process.env.ODM_DELETE_SHOTS) {
    await page.screenshot({ path: 'test-results/delete-1440.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Delete everywhere' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/delete-390.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await swap(page, () => page.getByRole('button', { name: 'Delete everywhere' }).click());
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator(`th[data-editor-target="${before.neighbour}"]`)).toBeFocused();
  await expect(page.locator('#message')).toHaveText(
    `Deleted ${before.row.name}. Undo to bring it back.`,
  );
  await expect(page.locator(`tr[data-node-id="${before.row.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-live-id="${before.row.id}"]`)).toHaveCount(0);
  await appSignal(page, () => {
    const h = window.odmApp.history,
      b = h.findLast((e) => e.type === 'swapped');
    return (
      b?.type === 'swapped' &&
      h.some((e) => e.type === 'trigger' && e.cycle >= Math.ceil(b.cycle) + 1)
    );
  });
  const values = await page.evaluate(() => {
    const h = window.odmApp.history,
      b = h.findLast((e) => e.type === 'swapped')!;
    return b.type === 'swapped'
      ? h
          .filter((e) => e.type === 'trigger' && e.time > b.time + 0.01)
          .map((e) => (e.type === 'trigger' ? (e.value as { s: string }).s : ''))
      : [];
  });
  expect(values.length).toBeGreaterThan(0);
  expect(values).not.toContain('bd');
  await swap(page, () => page.getByRole('button', { name: 'Undo', exact: true }).click());
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(before.doc);
  await expect(page.locator(`tr[data-node-id="${before.row.id}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-live-id="${before.row.id}"]`)).toHaveCount(1);
  await signal(() =>
    page.evaluate(() => {
      const h = window.odmApp.history,
        b = h.findLast((e) => e.type === 'swapped')!;
      return (
        b.type === 'swapped' &&
        h.some(
          (e) => e.type === 'trigger' && e.time >= b.time && (e.value as { s: string }).s === 'bd',
        )
      );
    }),
  ).toBe(true);
});

test('delete confirmation can be cancelled; the last instrument explains how to proceed', async ({
  page,
}) => {
  await openProgram(page, { source: 's("bd")' });
  const row = await page.evaluate(() => window.odmApp.state.rows[0]);
  await selectNode(page, { nodeId: row.id });
  await page.getByRole('button', { name: 'Delete instrument', exact: true }).click();
  await page.getByRole('button', { name: 'Keep instrument' }).click();
  await expect(page.getByRole('button', { name: 'Delete instrument', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Delete instrument', exact: true }).click();
  await page.getByRole('button', { name: 'Delete everywhere' }).click();
  await expect(page.locator('#editor').getByRole('alert')).toContainText(
    'only instrument. Add another instrument',
  );
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
