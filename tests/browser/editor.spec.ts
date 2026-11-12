import { test } from './helpers';
import { scoreReady, play, waitForPending, signal } from './helpers';
import { expect, type Page } from '@playwright/test';
import type {} from '../../src/app/main';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
async function open(page: Page) {
  await page.route(
    (url) => url.protocol === 'https:',
    (route) => route.abort('internetdisconnected'),
  );
  await page.goto('/?inspect');
}
const row = (page: Page, name: string) =>
  page.getByRole('row').filter({
    has: page
      .getByRole('rowheader')
      .filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) }),
  });
const cell = (page: Page, name: string, control: string) =>
  row(page, name).locator(`.sheet-cell[data-control="${control}"]`);
async function setValue(page: Page, value: number) {
  const input = page.getByRole('spinbutton');
  await input.fill(String(value));
  // Capture both treatments in the same input turn, before an asynchronous swap.
  const seen = await input.evaluate((el) => {
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      panel: document.querySelector('#editor-status')!.textContent,
      cell: document
        .querySelector('[data-editor-selected="true"]')
        ?.getAttribute('data-edit-state'),
    };
  });
  expect(seen).toEqual({ panel: 'Changing — not playing yet', cell: 'pending' });
}
test('constant editor: pending → swapped → trigger values → undo; readonly, focus and phone', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Kiln', exact: true }).click();
  await scoreReady(page);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  await play(page);
  const target = cell(page, 'bass', 'lpf');
  await target.click();
  await expect(page.locator('#editor-breadcrumb')).toHaveText('bass › lpf');
  const old = Number(await page.getByRole('spinbutton').inputValue());
  await setValue(page, 900);
  await waitForPending(page);
  await expect(page.locator('#editor-status')).toHaveText('Playing now');
  await signal(() =>
    page.evaluate(
      () =>
        window.odmApp.history.filter(
          (e) => e.type === 'trigger' && (e.value as { cutoff?: number }).cutoff === 900,
        ).length,
    ),
  ).toBeGreaterThan(0);
  const marker = await page.evaluate(() => window.odmApp.history.length);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('spinbutton')).toHaveValue(String(old));
  await signal(() =>
    page.evaluate(
      ({ old, marker }) =>
        window.odmApp.history
          .slice(marker)
          .filter((e) => e.type === 'trigger' && (e.value as { cutoff?: number }).cutoff === old)
          .length,
      { old, marker },
    ),
  ).toBeGreaterThan(0);
  await page.evaluate(() => {
    const engine = window.odmApp.engine!,
      original = engine.play;
    engine.play = () => {
      engine.play = original;
      return Promise.reject(Error('injected swap refusal'));
    };
  });
  await setValue(page, 1000);
  await expect(page.locator('#editor-status')).toContainText(
    'Change failed: injected swap refusal',
  );
  await expect(page.getByRole('spinbutton')).toHaveValue(String(old));
  await expect(target).toHaveAttribute('data-edit-state', 'failed');
  await expect(target).toContainText(String(old));
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).toBeHidden();
  await expect(target).toBeFocused();
  await target.press('Space');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await cell(page, 'lead', 'note').press('Enter');
  await expect(page.locator('#editor')).toContainText('Edit this rhythm');
  await expect(page.getByRole('slider')).toHaveCount(0);
});
test('section-local setting is distinct; signal stays read-only; arrow keys and undo shortcuts', async ({
  page,
}) => {
  await open(page);
  await page
    .getByLabel('Your Strudel program')
    .fill(
      'const chords=note(60).s("sine").lpf(450); const intro=stack(chords.lpf(600)); const build=stack(chords.lpf(sine.range(400,2000))); arrange([4,intro],[4,build],[4,chords])',
    );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await scoreReady(page);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'in intro: lpf 600', exact: true }).press('Enter');
  await expect(page.locator('#editor-breadcrumb')).toHaveText('chords › in intro › lpf');
  const slider = page.getByRole('slider');
  await slider.press('Shift+ArrowRight');
  await expect(page.getByRole('spinbutton')).toHaveValue('610');
  await expect(page.locator('#editor-status')).toHaveText('Plays on next start');
  await page.getByRole('spinbutton').focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('spinbutton')).toHaveValue('600');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('spinbutton')).toHaveValue('610');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'in intro: lpf 610', exact: true })).toBeFocused();
  await cell(page, 'chords', 'lpf').click();
  await expect(page.getByRole('spinbutton')).toHaveValue('450');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'in build: lpf signal', exact: true }).click();
  await expect(page.locator('#editor-breadcrumb')).toHaveText('chords › in build › lpf');
  await expect(page.locator('#editor')).toContainText('400 to 2000 Hz · signal');
  await expect(page.locator('input[type="range"]')).toHaveCount(0);
});
