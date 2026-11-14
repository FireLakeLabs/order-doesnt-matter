import { expect } from '@playwright/test';
import { test, openProgram, play, waitForPending } from './helpers';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

test('Kiln: planet to cutoff, Undo, rhythm and rewrites retain exact origin and playback context', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProgram(page, { example: 'Kiln' });
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  const bass = await page.evaluate(
    () => window.odmApp.state.rows.find((r) => r.name === 'bass')!.id,
  );
  const origin = page.locator(`[data-live-id="${bass}"]`);
  const original = await page.evaluate(() => window.odmApp.state.doc);
  await origin.press('Enter');
  const nav = page.getByRole('navigation', { name: 'Instrument settings and rewrites' });
  await nav.getByRole('button', { name: 'lpf', exact: true }).press('Enter');
  await expect(page.locator('#editor-breadcrumb')).toHaveText('bass › lpf');
  expect(
    await page.evaluate(() => ({
      doc: window.odmApp.state.doc,
      undo: window.odmApp.editor!.canUndo,
    })),
  ).toEqual({ doc: original, undo: false });
  const field = page.locator('#editor').getByRole('spinbutton');
  await expect(field).toBeFocused();
  await field.fill('900');
  await field.press('Tab');
  await waitForPending(page);
  await page.locator('#undo').click();
  await waitForPending(page);
  await expect(field).toHaveValue('700');
  await page.getByRole('button', { name: 'Back to bass', exact: true }).press('Enter');
  await nav.getByRole('button', { name: 'Rhythm', exact: true }).press('Enter');
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'rhythm');
  await page.locator('.editor-done').press('Enter');
  await expect(origin).toBeFocused();
  await play(page);
  await page.getByRole('button', { name: 'Section 3', exact: true }).click();
  const held = await page.evaluateHandle(() => ({
    doc: window.odmApp.state.doc,
    revision: window.odmApp.editor!.state.goodRevision,
    swaps: window.odmApp.history.filter((e) => e.type === 'swapped').length,
  }));
  await origin.press('Enter');
  await nav.getByRole('button', { name: 'Rewrites', exact: true }).press('Enter');
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'rewrite');
  await page.keyboard.press('Escape');
  await expect(origin).toBeFocused();
  expect(
    await held.evaluate((s) => ({
      doc: s.doc === window.odmApp.state.doc,
      revision: s.revision === window.odmApp.editor!.state.goodRevision,
      swaps: s.swaps === window.odmApp.history.filter((e) => e.type === 'swapped').length,
      playing: window.odmApp.state.playing,
    })),
  ).toEqual({ doc: true, revision: true, swaps: true, playing: true });
  await expect(page.locator('#editing-context')).toContainText('Editing Section 3');
  await expect(page.locator('#playback-context')).toContainText('Playing Section 2');
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(original);
  await held.dispose();
});

test('phone entry 14: settings navigation and enlarged Now preserve the full-name List origin', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 });
  const names = Array.from({ length: 14 }, (_, i) => `long_instrument_name_${i + 1}`);
  const source =
    names.map((name, i) => `const ${name}=note(${48 + i}).s("sine").lpf(700).fast(2);`).join('\n') +
    `\nstack(${names.join(',')})`;
  await openProgram(page, { source });
  await page.locator('.live-panel > summary').click();
  const list = page.locator('.live-list-disclosure');
  if (!(await list.evaluate((n) => n.hasAttribute('open')))) await list.locator('summary').click();
  const origin = page.locator('[data-list-id]').nth(13);
  await expect(origin).toBeVisible();
  const held = await origin.evaluateHandle((n) => ({ origin: n, doc: window.odmApp.state.doc }));
  for (const enlarged of [false, true]) {
    if (enlarged) await page.locator('#now-enlarge').press('Enter');
    await origin.press('Enter');
    await page
      .getByRole('navigation')
      .getByRole('button', { name: 'lpf', exact: true })
      .press('Enter');
    await expect(page.locator('#editor-breadcrumb')).toHaveText(`${names[13]} › lpf`);
    await expect(page.locator('#editor').getByRole('spinbutton')).toBeFocused();
    await page.getByRole('button', { name: `Back to ${names[13]}`, exact: true }).press('Enter');
    await page
      .getByRole('navigation')
      .getByRole('button', { name: 'fast', exact: true })
      .press('Enter');
    await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'rewrite');
    if (enlarged) await page.keyboard.press('Escape');
    else await page.locator('.editor-done').press('Enter');
    await expect(origin).toBeFocused();
    expect(
      await held.evaluate((s) => ({
        focus: document.activeElement === s.origin,
        doc: s.doc === window.odmApp.state.doc,
        undo: window.odmApp.editor!.canUndo,
        fits: document.documentElement.scrollWidth <= innerWidth,
      })),
    ).toEqual({ focus: true, doc: true, undo: false, fits: true });
    if (enlarged) await expect(page.locator('#preview-expanded')).toBeVisible();
  }
  await held.dispose();
});
