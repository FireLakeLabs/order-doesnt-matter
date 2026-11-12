import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { walk, type Setting } from '../../src/document';
import { generate } from '../../src/generate';
import { queryEventsNode } from '../../src/strudel/evaluate-node';
import { openProgram, play, selectNode, waitForPending } from './helpers';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

test('real techno: change room to alternating values, edit a cycle, preserve other triggers; phone and keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProgram(page, { path: 'corpus/programs/real-techno.strudel' });
  const doc = await page.evaluate(() => window.odmApp.state.doc!);
  let setting: Setting | undefined;
  walk(doc, (n) => {
    if ('name' in n && n.name === 'room' && 'value' in n) setting = n as Setting;
  });
  const origin = await selectNode(page, { nodeId: setting!.id });
  await page.getByRole('button', { name: 'Change over time', exact: true }).press('Enter');
  const input = page.getByRole('spinbutton', { name: 'Value 1.2 (×)', exact: true });
  await input.fill('0.987');
  await input.press('Enter');
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'values');
  await expect(page.locator('.values-lane')).toContainText('0.987');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/values-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page
      .locator('.values-editor button')
      .evaluateAll((nodes) => nodes.every((n) => n.getBoundingClientRect().height >= 44)),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/values-phone.png' });
  await page.keyboard.press('Escape');
  await expect(origin).toBeFocused();
  await origin.press('Enter');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(origin).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  await play(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.odmApp.history.filter((e) => e.type === 'trigger' && e.cycle >= 2).length,
      ),
    )
    .toBeGreaterThan(0);
  const triggers = await page.evaluate(() =>
    window.odmApp.history.filter((e) => e.type === 'trigger' && e.cycle < 2),
  );
  const expected = await queryEventsNode(generate(doc), 0, 2);
  expect(expected.error).toBeNull();
  expect(triggers.length).toBe(expected.events.filter((e) => e.hasOnset).length);
  for (const trigger of triggers) {
    if (trigger.type !== 'trigger') continue;
    const value = trigger.value as Record<string, unknown>;
    const original = expected.events.find(
      (e) =>
        e.hasOnset &&
        e.whole?.[0] === trigger.cycle &&
        (e.value as Record<string, unknown>).s === value.s,
    )!;
    expect(original).toBeDefined();
    expect(value).toEqual(
      value.s === 'cp'
        ? { ...(original.value as object), room: Math.floor(trigger.cycle) % 2 ? 0.987 : 0.5 }
        : original.value,
    );
  }
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

test('Kiln: constant → values → edit second → alternating triggers → undo twice restores constant', async ({
  page,
}) => {
  await openProgram(page, { example: 'Kiln' });
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  await page.getByRole('button', { name: 'Change over time', exact: true }).click();
  const second = page.getByRole('spinbutton', { name: 'Value 1.2 (Hz)', exact: true });
  await second.fill('900');
  await second.press('Enter');
  await play(page);
  await waitForPending(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.odmApp.history.filter((e) => e.type === 'trigger' && e.cycle >= 6).length,
      ),
    )
    .toBeGreaterThan(0);
  const bass = await page.evaluate(() =>
    window.odmApp.history.filter(
      (e) =>
        e.type === 'trigger' &&
        e.cycle >= 4 &&
        e.cycle < 6 &&
        (e.value as { cutoff?: number }).cutoff !== undefined,
    ),
  );
  expect(bass.length).toBeGreaterThan(0);
  for (const e of bass)
    if (e.type === 'trigger')
      expect((e.value as { cutoff: number }).cutoff).toBe(Math.floor(e.cycle) % 2 ? 900 : 700);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(second).toHaveValue('700');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'constant');
  await expect(page.getByRole('spinbutton')).toHaveValue('700');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

test('nested values keep their spans; groups, rests, modifiers, chunk parse refusals and undo use the same editor', async ({
  page,
}) => {
  await openProgram(page, {
    source: 'note("c4*8").s("sine").gain(".8@3 [.3 .9] .7!2? {.1 .2}%2")',
  });
  await selectNode(page, { breadcrumb: ['Instrument 1', 'gain'] });
  const spans = await page.locator('.values-lane rect').evaluateAll((nodes) =>
    nodes.map((n) => ({
      x: Number(n.getAttribute('x')),
      width: Number(n.getAttribute('width')),
    })),
  );
  const events = await page.evaluate(() => Object.values(window.odmApp.state.events)[0].events);
  expect(spans).toEqual(
    events.map((e) => ({ x: (e.part[0] / 4) * 1000, width: ((e.part[1] - e.part[0]) / 4) * 1000 })),
  );
  await page
    .getByRole('combobox', { name: 'Group 2 timing', exact: true })
    .selectOption('alternate');
  const field = page.getByRole('spinbutton', { name: 'Value 2.1 (×)', exact: true });
  await field.fill('.6');
  await field.press('Enter');
  await page.getByRole('button', { name: 'Switch off', exact: true }).nth(1).click();
  await page.getByRole('button', { name: 'Switch on', exact: true }).click();
  await expect(field).toHaveValue('.6');
  const chunk = page.getByRole('textbox', {
    name: 'Value 4: Different cycle lengths',
    exact: true,
  });
  await chunk.fill('[');
  await page.getByRole('button', { name: 'Save text', exact: true }).click();
  await expect(page.locator('.values-editor [role="alert"]')).toContainText('does not parse');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch on', exact: true })).toHaveCount(1);
});
