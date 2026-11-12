import { expect } from '@playwright/test';
import {
  test,
  openProgram,
  play,
  selectNode,
  swap,
  appSignal,
  waitForPending,
  throughCycle,
} from './helpers';
import { instruments } from '../../src/document';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
async function openBass(page: import('@playwright/test').Page) {
  const doc = await page.evaluate(() => window.odmApp.state.doc!);
  const bass = instruments(doc).find((r) => r.name === 'bass')!;
  return selectNode(page, { nodeId: `${bass.pattern.id}:rhythm` });
}
test('Kiln: edited pitch is triggered; splitting then resting the first half moves its onset', async ({
  page,
}) => {
  await openProgram(page, { example: 'Kiln' });
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  await openBass(page);
  await play(page);
  const value = page.getByLabel('Note value', { exact: true });
  await value.fill('83');
  await swap(page, () => value.press('Enter'));
  await page.getByRole('button', { name: 'Split in 2', exact: true }).click();
  await page.locator('[data-path="0"]').press('ArrowDown');
  await swap(page, () => page.getByRole('button', { name: 'Rest', exact: true }).click());
  await waitForPending(page);
  await expect(page.getByRole('button', { name: 'Bring back', exact: true })).toBeVisible();
  await appSignal(page, () => {
    const row = window.odmApp.state.rows.find((r) => r.name === 'bass')!;
    return window.odmApp.state.events[row.id].events.some((e) => e.whole?.[0] === 4.125);
  });
  await appSignal(page, () =>
    window.odmApp.history.some(
      (e) =>
        e.type === 'trigger' &&
        String((e.value as { note?: unknown }).note) === '83' &&
        Math.abs((e.cycle % 1) - 0.125) < 1e-8,
    ),
  );
  const cycle = await page.evaluate(() =>
    Math.ceil(window.odmApp.history.filter((e) => e.type === 'swapped').at(-1)!.cycle),
  );
  await throughCycle(page, cycle + 1);
  const triggered = await page.evaluate(
    (c) =>
      window.odmApp.history
        .filter(
          (e) =>
            e.type === 'trigger' &&
            e.cycle >= c &&
            e.cycle < c + 1 &&
            (e.value as { s?: string }).s === 'triangle',
        )
        .map((e) => (e.type === 'trigger' ? e.cycle - c : -1)),
    cycle,
  );
  expect(triggered).toEqual([0.125, 0.25, 0.5, 0.75]);
  const spans = await page.evaluate(() => {
    const row = window.odmApp.state.rows.find((r) => r.name === 'bass')!;
    return window.odmApp.state.events[row.id].events
      .filter((e) => e.whole && e.whole[0] === e.part[0] && e.whole[0] >= 4 && e.whole[0] < 5)
      .map((e) => e.whole);
  });
  expect(spans).toEqual([
    [4.125, 4.25],
    [4.25, 4.5],
    [4.5, 4.75],
    [4.75, 5],
  ]);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
test('real house: a bass edit reaches triggers and preserves every other instrument onset bag', async ({
  page,
}) => {
  await openProgram(page, { path: 'corpus/programs/real-house-arranged.strudel' });
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  await openBass(page);
  const before = await page.evaluate(() => window.odmApp.state.events);
  const value = page.getByLabel('Note value', { exact: true });
  await value.fill('83');
  await value.press('Enter');
  await waitForPending(page);
  await play(page);
  await appSignal(page, () =>
    window.odmApp.history.some(
      (e) => e.type === 'trigger' && String((e.value as { note?: unknown }).note) === '83',
    ),
  );
  const state = await page.evaluate(() => ({
    rows: window.odmApp.state.rows,
    events: window.odmApp.state.events,
  }));
  const onset = (events: (typeof before)[string]['events']) =>
    events
      .filter((e) => e.whole && e.part[0] === e.whole[0])
      .map((e) => JSON.stringify([e.whole, e.value]))
      .sort();
  for (const row of state.rows) {
    if (row.name !== 'bass')
      expect(onset(state.events[row.id].events)).toEqual(onset(before[row.id].events));
    else expect(onset(state.events[row.id].events)).not.toEqual(onset(before[row.id].events));
  }
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
test('phone: List, arrow selection, Done and Escape return focus, no horizontal page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProgram(page, { example: 'Kiln' });
  const origin = await openBass(page);
  await expect(page.locator('[data-view="List"]')).toBeVisible();
  await page.locator('[data-path="0"]').press('ArrowRight');
  await expect(page.locator('[data-path="1"]')).toBeFocused();
  await page.getByRole('button', { name: 'Boxes', exact: true }).click();
  await expect(page.locator('[data-view="Boxes"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page
      .locator('.rhythm-editor button')
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => n.getBoundingClientRect().width > 0)
          .every((n) => n.getBoundingClientRect().height >= 44),
      ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(origin).toBeFocused();
  await origin.press('Enter');
  await expect(page.getByRole('button', { name: 'Boxes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(origin).toBeFocused();
});
