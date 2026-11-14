import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { test, openProgram, scoreReady, selectNode, play, signal, appSignal } from './helpers';
import { RECOVERY_KEY } from '../../src/app/retention';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

async function download(page: import('@playwright/test').Page, button: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const file = await pending;
  return readFile((await file.path())!, 'utf8');
}

test('Kiln visual edit → Undo/Redo → JSON reopen → reload recovery → generated source import', async ({
  page,
}) => {
  await openProgram(page, { example: 'Kiln' });
  const original = await page.evaluate(() => window.odmApp.state.doc);
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  await page.getByRole('spinbutton').fill('900');
  await page.getByRole('spinbutton').press('Tab');
  await page.keyboard.press('Escape');
  const edited = await page.evaluate(() => window.odmApp.state.doc);
  expect(edited).not.toEqual(original);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await scoreReady(page);
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(edited);
  await appSignal(page, () =>
    Object.values(window.odmApp.state.events).some((answer) =>
      answer.events.some((e) => (e.value as { cutoff?: number }).cutoff === 900),
    ),
  );
  const events = await page.evaluate(() => window.odmApp.state.events);
  await page.getByRole('button', { name: 'Keep work', exact: true }).click();
  const json = await download(page, 'Download document');
  expect(JSON.parse(json)).toEqual(edited);
  const strudel = await download(page, 'Export Strudel');
  expect(strudel).toContain('900');
  expect(strudel).not.toBe(await page.getByLabel('Your Strudel program').inputValue());
  await page
    .locator('#document-file')
    .setInputFiles({ name: 'kiln.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await appSignal(page, () => !window.odmApp.editor!.canUndo);
  await scoreReady(page);
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(edited);
  expect(await page.evaluate(() => window.odmApp.state.events)).toEqual(events);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Recover last work' })).toBeVisible();
  expect(await page.evaluate(() => window.odmApp.state.doc)).toBeNull();
  expect(await page.evaluate(() => window.odmApp.engine)).toBeNull();
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), RECOVERY_KEY),
  ).toEqual(edited);
  await page.getByRole('button', { name: 'Recover last work' }).click();
  await scoreReady(page);
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(edited);
  expect(await page.evaluate(() => window.odmApp.state.playing)).toBe(false);
  const answers = () =>
    page.evaluate(() => Object.values(window.odmApp.state.events).map((r) => r.events));
  const before = await answers();
  await expect(page.getByLabel('Your Strudel program')).toHaveValue('');
  await page.getByLabel('Your Strudel program').fill(strudel);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await appSignal(page, (code) => window.odmApp.state.source === code, strudel);
  await scoreReady(page);
  expect(await answers()).toEqual(before);
});

test('cancelled replacements and malformed documents preserve edited history and active music', async ({
  page,
}) => {
  await openProgram(page, { example: 'Kiln' });
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  await page.getByRole('spinbutton').fill('900');
  await page.getByRole('spinbutton').press('Tab');
  await page.keyboard.press('Escape');
  await play(page);
  const snapshot = await page.evaluate(() => {
    window.retainedSession = window.odmApp.editor;
    return window.odmApp.state.doc;
  });
  await page.getByRole('button', { name: 'Lichen', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Replace current work?' });
  await expect(modal.getByRole('button', { name: 'Keep current' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Keep work', exact: true }).click();
  for (const text of ['{', '{"version":99,"body":[]}', '{"version":2,"body":[{}]}']) {
    await page
      .locator('#document-file')
      .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(page.locator('#load-error')).toContainText('Could not open document');
  }
  await page.locator('#document-file').setInputFiles({
    name: 'valid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(snapshot)),
  });
  await modal.getByRole('button', { name: 'Keep current' }).click();
  expect(await page.evaluate(() => window.odmApp.editor === window.retainedSession)).toBe(true);
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(snapshot);
  expect(
    await page.evaluate(() => window.odmApp.state.playing && window.odmApp.engine!.playing),
  ).toBe(true);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  const count = await page.evaluate(
    () => window.odmApp.history.filter((e) => e.type === 'trigger').length,
  );
  await signal(() =>
    page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'trigger').length),
  ).toBeGreaterThan(count);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

for (const failure of ['denied', 'quota', 'corrupt'])
  test(`phone keyboard retention remains usable with ${failure} storage`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      ({ key, failure }) => {
        if (failure === 'corrupt') localStorage.setItem(key, '{');
        if (failure === 'denied')
          Storage.prototype.getItem = () => {
            throw Error('denied');
          };
        if (failure !== 'corrupt')
          Storage.prototype.setItem = () => {
            throw Error('quota');
          };
      },
      { key: RECOVERY_KEY, failure },
    );
    await openProgram(page);
    if (failure !== 'quota')
      await expect(page.locator('#recovery-status')).toContainText('could not be read');
    await page.getByLabel('Your Strudel program').fill('note("c4 e4").s("sine")');
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await scoreReady(page);
    await expect(page.locator('#recovery-status')).toBeVisible();
    if (failure !== 'corrupt')
      await expect(page.locator('#recovery-status')).toContainText('could not be saved');
    await page.getByRole('button', { name: 'Download document' }).focus();
    const pending = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    expect(JSON.parse(await readFile((await (await pending).path())!, 'utf8')).version).toBe(2);
    await download(page, 'Export Strudel');
    await play(page);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    for (const button of await page.locator('#keep-panel button:visible').all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

declare global {
  interface Window {
    retainedSession: typeof window.odmApp.editor;
  }
}
