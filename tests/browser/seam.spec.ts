import { expect, test } from '@playwright/test';
import { instruments } from '../../src/document';
import { describeTarget } from '../../src/document/edit';
import { openProgram, play, selectNode, waitForPending, triggerValues } from './helpers';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

test('real house: instrument, rewrite, signal, section, rhythm and constant share one editor', async ({
  page,
}) => {
  await openProgram(page, { path: 'corpus/programs/real-house-arranged.strudel' });
  const doc = await page.evaluate(() => window.odmApp.state.doc!);
  const bass = instruments(doc).find((r) => r.name === 'bass')!;
  await selectNode(page, { nodeId: bass.id });
  await expect(page.locator('#editor-breadcrumb')).toHaveText('bass');
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'readonly');
  expect(describeTarget(doc, bass.id).kind).toBe('instrument');
  await expect(page.locator('#editor')).toContainText('instrument editing');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const chip = page.locator('.sheet-chips [data-editor-target]').first();
  await chip.press('Enter');
  await expect(page.locator('#editor')).toContainText('ordered rewrite');
  await expect(page.locator('[data-editor-selected="true"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(chip).toBeFocused();
  const signal = await page
    .locator('[data-editor-target]')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.editorTarget!));
  const signalId = signal.find((id) => describeTarget(doc, id).kind === 'setting-signal')!;
  await selectNode(page, { nodeId: signalId });
  await expect(page.locator('#editor')).toContainText('driven by a signal');
  await expect(page.getByRole('slider')).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const windowBefore = await page.locator('#window').textContent();
  const sectionEdit = page.getByRole('button', { name: 'Edit section drop', exact: true }).first();
  await sectionEdit.press('Space');
  await expect(page.locator('#editor')).toContainText('section editing');
  await expect(page.locator('#window')).toHaveText(windowBefore!);
  await page.keyboard.press('Escape');
  await expect(sectionEdit).toBeFocused();
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  await selectNode(page, { nodeId: `${bass.pattern.id}:rhythm` });
  await expect(page.locator('#editor')).toContainText('rhythm editing');
  await page.keyboard.press('Escape');
  await play(page);
  await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'constant');
  await expect(page.getByRole('spinbutton')).toHaveValue('450');
  await page.getByRole('spinbutton').fill('900');
  await page.getByRole('spinbutton').press('Enter');
  await waitForPending(page);
  await expect
    .poll(
      async () =>
        (await triggerValues(page)).filter((v) => (v as { cutoff?: number }).cutoff === 900).length,
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
