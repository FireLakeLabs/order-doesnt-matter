import { expect } from '@playwright/test';
import { test, openProgram, selectNode, scoreReady, appSignal } from './helpers';

const doc = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.odmStudio.app.state.doc);
const undo = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Undo', exact: true }).click();

test('Studio section and setup editors preserve document edits, checklist membership and Undo', async ({
  page,
}) => {
  await openProgram(page, { path: 'corpus/programs/real-house-arranged.strudel' });
  const original = await doc(page);
  await page.getByRole('button', { name: 'Sections', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit section intro', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Length in cycles' }).fill('8');
  await page.getByRole('spinbutton', { name: 'Length in cycles' }).press('Enter');
  await scoreReady(page);
  expect(
    await page.evaluate(() => window.odmStudio.app.state.sections.map((s) => s.start)),
  ).toEqual([0, 8, 12, 20, 24]);
  await undo(page);
  expect(await doc(page)).toEqual(original);
  await page.getByRole('checkbox', { name: 'kick', exact: true }).check();
  await scoreReady(page);
  expect(await doc(page)).not.toEqual(original);
  await undo(page);
  expect(await doc(page)).toEqual(original);
  await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
  await openProgram(page, { source: 'samples({ kick: "kick.wav" }); note(60)' });
  const setupOriginal = await doc(page);
  await page.getByRole('button', { name: 'Score setup', exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Loads sounds' }).first().click();
  const source = page.getByLabel('Source text', { exact: true });
  const setup = await source.inputValue();
  await source.fill(setup + '\n// retained setup edit');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('#editor')).toContainText('Applied.');
  await undo(page);
  expect(await doc(page)).toEqual(setupOriginal);
});

test('Studio deletion removes a real instrument everywhere, cancels safely and preserves dependent navigation', async ({
  page,
}) => {
  await openProgram(page, { example: 'Kiln' });
  const original = await doc(page);
  const id = await page.evaluate(() => window.odmStudio.app.state.rows[0].id);
  await selectNode(page, { nodeId: id });
  await page.getByRole('button', { name: 'Delete instrument', exact: true }).click();
  await page.getByRole('button', { name: 'Keep instrument', exact: true }).click();
  expect(await doc(page)).toEqual(original);
  await page.getByRole('button', { name: 'Delete instrument', exact: true }).click();
  await page.getByRole('button', { name: 'Delete everywhere', exact: true }).click();
  await expect(page.locator(`.lane-label[data-instrument="${id}"]`)).toHaveCount(0);
  await expect(page.locator('#editor')).toBeHidden();
  await undo(page);
  expect(await doc(page)).toEqual(original);
  await expect(page.locator(`.lane-label[data-instrument="${id}"]`)).toHaveCount(1);
  await openProgram(page, {
    source: 'const drum=s("sine"); const hat=s("triangle").gain(drum); stack(drum,hat)',
  });
  const dependent = await doc(page);
  await selectNode(page, { breadcrumb: ['drum'] });
  await page.getByRole('button', { name: 'Delete instrument', exact: true }).click();
  await page.getByRole('button', { name: 'Delete everywhere', exact: true }).click();
  await page.getByRole('button', { name: 'Go to hat › gain', exact: true }).click();
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'generic');
  expect(await doc(page)).toEqual(dependent);
});

test('Studio rejected paste, engine error and late sound discovery stay visible', async ({
  page,
}) => {
  await openProgram(page);
  const retained = await doc(page);
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page.getByLabel('Strudel program').fill('new Pattern(()=>{while(true){}})');
  await page.getByRole('button', { name: 'Import program', exact: true }).click();
  await appSignal(page, function timedOutScore() {
    return window.odmStudio.app.state.loadError.includes('timed out');
  });
  await expect(page.locator('.top-message')).toContainText('timed out');
  expect(await doc(page)).toEqual(retained);
  await page.getByRole('button', { name: 'Lichen', exact: true }).click();
  await scoreReady(page);
  await expect(page.locator('.top-message')).toBeEmpty();
  await openProgram(page, { source: 'note("not_a_note").s("sine")' });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await appSignal(page, function engineReportedError() {
    return window.odmStudio.app.history.some((e) => e.type === 'error');
  });
  await expect(page.locator('.top-message')).not.toBeEmpty();
  const sections = Array.from({ length: 32 }, () => '[4,early]').join(',');
  await openProgram(page, {
    source: `const early=s("triangle"); const late=note(60).s("sine"); arrange(${sections},[4,late])`,
  });
  await selectNode(page, { breadcrumb: ['late'] });
  await expect(page.locator('#editor')).toContainText('sine: not loaded yet');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await appSignal(page, function playbackReady() {
    return window.odmStudio.app.state.playing;
  });
  // Studio keeps an undiscovered sound distinct from a ready one. The retired
  // table's playback-only 'not used yet' wording is no longer a UI surface.
  await expect(page.locator('#editor')).toContainText('sine: not loaded yet');
  await page.evaluate(() => window.odmStudio.seek(128));
  await appSignal(page, function lateAssetReady() {
    return window.odmStudio.app.state.sounds.some(
      (sound) => sound.name === 'sine' && sound.state === 'ready',
    );
  });
  await expect(page.locator('#editor')).toContainText('sine: ready');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(await page.evaluate(() => window.odmStudio.app.state.playing)).toBe(false);
});
