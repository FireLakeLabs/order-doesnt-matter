import { signal, openProgram, play, selectNode, waitForPending } from './helpers';
import { expect, test, type Page } from '@playwright/test';
import { instruments } from '../../src/document';
import { generate } from '../../src/generate';
import { queryEventsNode } from '../../src/strudel/evaluate-node';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
const editor = (page: Page) => page.locator('#editor');
async function exact(page: Page, value: number) {
  await editor(page).getByRole('spinbutton').fill(String(value));
  await editor(page).getByRole('spinbutton').press('Enter');
  await waitForPending(page);
}
for (const scenario of ['double', 'reset', 'degrade', 'order', 'restore'] as const)
  test(`real house rewrite: ${scenario} preserves other triggers`, async ({ page }) => {
    await openProgram(page, { path: 'corpus/programs/real-house-arranged.strudel' });
    // Accelerate transport only, retaining the real score and event assertions.
    await page.evaluate(() => {
      const doc = window.odmApp.state.doc!;
      window.odmApp.editor!.apply({
        ...doc,
        body: doc.body.map((n) => (n.kind === 'tempo' ? { ...n, cpm: 240 } : n)),
      });
    });
    const original = await page.evaluate(() => window.odmApp.state.doc!);
    const kick = instruments(original).find((r) => r.name === 'kick')!;
    await page.getByRole('button', { name: 'drop', exact: true }).first().click();
    const add = await selectNode(page, { nodeId: `${kick.pattern.id}:rewrites` });
    await expect(editor(page)).toHaveAttribute('data-editor-kind', 'rewrite');
    await editor(page).getByRole('button', { name: 'Add fast', exact: true }).press('Enter');
    await exact(page, 2);
    await play(page);
    const stable = (v: unknown): string =>
      v && typeof v === 'object'
        ? Array.isArray(v)
          ? `[${v.map(stable)}]`
          : `{${Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => `${k}:${stable(x)}`)}}`
        : JSON.stringify(v);
    async function check(multiplier: number) {
      const cycle = await page.evaluate(() => Math.ceil(window.odmApp.engine!.now()!) + 1);
      await signal(() =>
        page.evaluate(
          (c) => window.odmApp.history.some((e) => e.type === 'trigger' && e.cycle >= c + 1),
          cycle,
        ),
      ).toBe(true);
      const actual = await page.evaluate(
        (c) =>
          window.odmApp.history
            .filter((e) => e.type === 'trigger' && e.cycle >= c && e.cycle < c + 1)
            .map((e) => (e as { value: unknown }).value),
        cycle,
      );
      const expected = await queryEventsNode(generate(original), cycle, cycle + 1);
      expect(expected.error).toBeNull();
      const kickValue = (v: unknown) => (v as { s?: string }).s === 'bd';
      const bags = expected.events.filter((e) => e.hasOnset).map((e) => e.value);
      expect(actual.filter(kickValue)).toHaveLength(bags.filter(kickValue).length * multiplier);
      expect(
        actual
          .filter((v) => !kickValue(v))
          .map(stable)
          .sort(),
      ).toEqual(
        bags
          .filter((v) => !kickValue(v))
          .map(stable)
          .sort(),
      );
    }
    if (scenario === 'double') {
      await check(2);
      return;
    }
    await exact(page, 1);
    if (scenario === 'reset') {
      await check(1);
      return;
    }
    await expect(editor(page).getByRole('img', { name: 'Without fast' })).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(add).toBeFocused();
    await add.press('Space');
    await editor(page).getByRole('button', { name: 'Add degradeBy', exact: true }).press('Enter');
    await exact(page, 1);
    if (scenario === 'degrade') {
      await check(0);
      return;
    }
    if (scenario === 'order') {
      await editor(page).getByRole('button', { name: 'Move earlier', exact: true }).press('Enter');
      await waitForPending(page);
      await expect(editor(page).locator('ol')).toContainText(/degradeBy[\s\S]*fast/);
      await editor(page).getByRole('button', { name: 'Move later', exact: true }).press('Space');
      await waitForPending(page);
      await expect(editor(page).locator('ol')).toContainText(/fast[\s\S]*degradeBy/);
      return;
    }
    await editor(page).getByRole('button', { name: 'Remove rewrite', exact: true }).click();
    await waitForPending(page);
    await editor(page).getByRole('button', { name: 'Edit fast', exact: true }).click();
    await editor(page).getByRole('button', { name: 'Remove rewrite', exact: true }).click();
    await waitForPending(page);
    await check(1);
    await page.keyboard.press('Escape');
    await expect(add).toBeFocused();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
  });
test('real ambient rewrite: preview, keyboard focus and phone', async ({ page }) => {
  await openProgram(page, { path: 'corpus/programs/real-ambient.strudel' });
  await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
  const doc = await page.evaluate(() => window.odmApp.state.doc!);
  const row = instruments(doc).find((r) =>
    r.pattern.layers.some((l) => l.kind === 'rewrite' && l.name === 'slow'),
  )!;
  const layer = row.pattern.layers.find((l) => l.kind === 'rewrite' && l.name === 'slow')!;
  const chip = await selectNode(page, { nodeId: layer.id });
  await exact(page, 3);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(editor(page).getByRole('img', { name: 'Without slow' })).toBeVisible();
  await editor(page).evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'test-results/rewrite-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const box of await editor(page)
    .locator('button,input')
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height)))
    expect(box).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: 'test-results/rewrite-phone.png' });
  await editor(page).locator('figure').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/rewrite-phone-details.png' });
  await page.keyboard.press('Escape');
  await expect(chip).toBeFocused();
});

test('pattern parsing refuses invalid text; callback/source stay read-only and slider drag undoes once', async ({
  page,
}) => {
  await openProgram(page, {
    source: 'const beat=s("bd").fast("<1 2>").off(.5,p=>p.rev()).degradeBy(.2); beat',
  });
  const chip = page.locator('.sheet-chips [data-editor-target]').first();
  await chip.press('Enter');
  const field = editor(page).getByRole('textbox');
  await field.fill('[');
  await field.press('Enter');
  await expect(editor(page).getByRole('alert')).toContainText('could not be parsed');
  await expect(chip).toContainText('<1 2>');
  await field.fill('<2 4>');
  await field.press('Enter');
  await expect(chip).toContainText('<2 4>');
  await editor(page).getByRole('button', { name: 'Edit off', exact: true }).click();
  await expect(editor(page)).toContainText('Edited as source for now');
  await expect(editor(page).getByRole('spinbutton')).toHaveCount(1);
  await editor(page).getByRole('button', { name: 'Edit degradeBy', exact: true }).click();
  const slider = editor(page).getByRole('slider');
  await slider.dispatchEvent('pointerdown');
  for (const value of ['.4', '.6', '.8'])
    await slider.evaluate((el, value) => {
      (el as HTMLInputElement).value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  await slider.dispatchEvent('pointerup');
  await expect(editor(page).getByRole('spinbutton')).toHaveValue('0.8');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(editor(page).getByRole('spinbutton')).toHaveValue('0.2');
});
