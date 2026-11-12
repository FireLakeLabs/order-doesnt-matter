import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { appSignal, openProgram, play, scoreReady, swap } from './helpers';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

test('real house: keyboard length edit retains the section and updates its window', async ({
  page,
}) => {
  await openProgram(page, { path: 'corpus/programs/real-house-arranged.strudel' });
  await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
  await page.getByRole('button', { name: 'intro', exact: true }).click();
  const before = await page.evaluate(() => window.odmApp.state.selected);
  const edit = page.getByRole('button', { name: 'Edit section intro', exact: true });
  await edit.press('Enter');
  const length = page.getByRole('spinbutton', { name: 'Length in cycles' });
  await length.fill('8');
  await length.press('Enter');
  await scoreReady(page);
  expect(
    await page.evaluate(() => ({
      id: window.odmApp.state.selected,
      from: window.odmApp.state.fromCycle,
      to: window.odmApp.state.toCycle,
      starts: window.odmApp.state.sections.map((s) => s.start),
    })),
  ).toEqual({ id: before, from: 0, to: 8, starts: [0, 8, 12, 20, 24] });
  await expect(page.getByRole('button', { name: 'intro', exact: true })).toContainText('8 cycles');
  await page.locator('.editor-body').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/section-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/section-phone.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await length.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(edit).toBeFocused();
  await edit.press('Space');
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
});
test('real house: section checklist stops kick triggers and keeps the other rows', async ({
  page,
}) => {
  await openProgram(page, {
    source: (await readFile('corpus/programs/real-house-arranged.strudel', 'utf8')).replace(
      /setcpm\([^)]*\)/,
      'setcpm(90)',
    ),
  });
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  await page.getByRole('button', { name: 'Edit section drop', exact: true }).first().click();
  await expect(page.locator('#editor')).toContainText(
    'This section is used 2 times; the change applies to both',
  );
  await play(page);
  await swap(page, () => page.getByRole('checkbox', { name: 'kick', exact: true }).press('Space'));
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
      b = h.findLast((e) => e.type === 'swapped');
    return h
      .filter((e) => e.type === 'trigger' && b?.type === 'swapped' && e.time > b.time + 0.01)
      .map((e) => (e.type === 'trigger' ? (e.value as { s: string }).s : ''));
  });
  expect(values.length).toBeGreaterThan(2);
  expect(values).not.toContain('bd');
  expect(values).toContain('sawtooth');
  const kick = await page.evaluate(
    () => window.odmApp.state.rows.find((r) => r.name === 'kick')!.id,
  );
  await expect(page.locator(`tr[data-node-id="${kick}"]`)).toContainText('plays in no section');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
test('make sections confirms the loop; strip plus opens an empty section checklist', async ({
  page,
}) => {
  await openProgram(page, { source: 'note("<60 61 62 63 64>").s("sine")' });
  await page.getByRole('button', { name: 'Make sections', exact: true }).click();
  await expect(page.locator('#editor')).toContainText(
    'The section order will repeat every 4 cycles',
  );
  await page.locator('#editor').getByRole('button', { name: 'Make sections', exact: true }).click();
  await expect(page.locator('#editor-breadcrumb')).toContainText('Section 1');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Add a section', exact: true }).click();
  await expect(page.locator('#editor-breadcrumb')).toContainText('Section 2');
  await expect(page.locator('#editor')).toContainText('Who plays');
  await expect(page.locator('#editor input[type="checkbox"]:checked')).toHaveCount(0);
});
