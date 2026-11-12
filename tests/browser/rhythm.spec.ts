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
        .map((e) =>
          e.type === 'trigger'
            ? { cycle: e.cycle - c, note: String((e.value as { note?: unknown }).note) }
            : null,
        ),
    cycle,
  );
  expect(triggered.map((e) => e!.cycle)).toEqual([0.125, 0.25, 0.5, 0.75]);
  expect(triggered[0]!.note).toBe('83');
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
  // Playback can acknowledge before the independent score worker replaces its
  // previous result. Wait for that row's queried value before comparing bags.
  await appSignal(page, () => {
    const row = window.odmApp.state.rows.find((r) => r.name === 'bass')!;
    return window.odmApp.state.events[row.id]?.events.some(
      (e) => String((e.value as { note?: unknown }).note) === '83',
    );
  });
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
  for (const action of ['Split in 2', 'Take turns']) {
    await page.getByRole('button', { name: action, exact: true }).press('Enter');
    await page.locator('[data-path="1"]').press('ArrowDown');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('[data-path="1.0"]')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Boxes', exact: true }).click();
  await expect(page.locator('[data-view="Boxes"]')).toBeVisible();
  await page.getByText('Speed and length', { exact: true }).press('Enter');
  const faster = page.getByLabel('Faster ×n', { exact: true });
  await faster.fill('3/2');
  await faster.press('Enter');
  await expect(page.getByLabel('Faster ×n', { exact: true })).toHaveValue('1.5');
  await page.getByLabel('Faster ×n', { exact: true }).press('ArrowUp');
  await expect(page.getByLabel('Faster ×n', { exact: true })).toHaveValue('2.5');
  await page.getByRole('button', { name: 'None for Faster ×n', exact: true }).press('Enter');
  await expect(page.getByLabel('Faster ×n', { exact: true })).toHaveValue('1');
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
test('desktop fine pointer: eight proportional boxes and edited row above the drawer', async ({
  page,
}) => {
  test.setTimeout(3000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProgram(page, { source: 'note("c2 d2@2 e2 f2 g2 a2 b2 c3").s("sine")' });
  await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
  await selectNode(page, { breadcrumb: ['Instrument 1', 'Rhythm'] });
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(false);
  const boxes = page.locator('.rhythm-boxes [data-path]');
  await expect(boxes).toHaveCount(8);
  const geometry = await page.evaluate(() => {
    const bar = document.querySelector('.rhythm-boxes')!.getBoundingClientRect();
    return {
      width: bar.width,
      parts: Array.from(document.querySelectorAll('.rhythm-boxes [data-path]')).map(
        (n) => n.getBoundingClientRect().width,
      ),
      row: document
        .querySelector('[data-editor-selected="true"]')!
        .closest('tr')!
        .getBoundingClientRect()
        .toJSON(),
      drawer: document.querySelector('#editor')!.getBoundingClientRect().toJSON(),
    };
  });
  geometry.parts.forEach((width, i) =>
    expect(Math.abs(width - (geometry.width * (i === 1 ? 2 : 1)) / 9)).toBeLessThanOrEqual(1),
  );
  expect(geometry.row.top).toBeGreaterThanOrEqual(0);
  expect(geometry.row.bottom).toBeLessThanOrEqual(geometry.drawer.top);
  for (let i = 0; i < 8; i++) {
    await boxes.nth(i).click();
    await expect(boxes.nth(i)).toHaveAttribute('aria-pressed', 'true');
  }
});

test('Kiln live: split removal, undo, literal marks and evenly spread drum hits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProgram(page, { example: 'Kiln' });
  // Shorten scheduling waits while retaining the bundled score.
  await page.evaluate(() => {
    const doc = window.odmApp.state.doc!;
    window.odmApp.editor!.apply({
      ...doc,
      body: doc.body.map((n) => (n.kind === 'tempo' ? { ...n, cpm: 240 } : n)),
    });
  });
  await page.getByRole('button', { name: 'Section 2', exact: true }).press('Enter');
  await openBass(page);
  await play(page);
  await page.getByRole('button', { name: 'Split in 2', exact: true }).press('Enter');
  await page.locator('[data-path="0"]').press('ArrowDown');
  await page.getByRole('button', { name: 'Remove', exact: true }).press('Enter');
  await expect(page.locator('[data-path="0.0"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove', exact: true }).press('Enter');
  await swap(page, () => page.getByRole('button', { name: 'Undo', exact: true }).press('Enter'));
  await waitForPending(page);
  await page.keyboard.press('Escape');
  const doc = await page.evaluate(() => window.odmApp.state.doc!);
  const clap = instruments(doc).find((r) => JSON.stringify(r.pattern.core).includes('cp'))!;
  const origin = await selectNode(page, { nodeId: `${clap.pattern.id}:rhythm` });
  await page.getByRole('button', { name: 'List', exact: true }).press('Enter');
  await page.locator('[data-path="0"]').press('ArrowRight');
  await page.getByRole('button', { name: 'Spread hits evenly…', exact: true }).press('Enter');
  await page.getByLabel('hits', { exact: true }).fill('3');
  await swap(page, () => page.getByLabel('hits', { exact: true }).press('Enter'));
  await expect(page.getByLabel('hits', { exact: true })).toBeFocused();
  await expect(page.getByLabel('out of', { exact: true })).toHaveValue('8');
  const boundary = await page.evaluate(() =>
    Math.ceil(window.odmApp.history.filter((e) => e.type === 'swapped').at(-1)!.cycle),
  );
  await throughCycle(page, boundary + 1);
  const bassStarts = await page.evaluate(
    (c) =>
      window.odmApp.history
        .filter(
          (e) =>
            e.type === 'trigger' &&
            e.cycle >= c &&
            e.cycle < c + 1 &&
            (e.value as { s?: string; gain?: number }).s === 'triangle' &&
            (e.value as { gain?: number }).gain === 0.45,
        )
        .map((e) => (e.type === 'trigger' ? e.cycle - c : -1)),
    boundary,
  );
  expect(bassStarts).toEqual([0, 0.25, 0.5, 0.75]);
  expect(
    await page.evaluate(
      (c) =>
        window.odmApp.history
          .filter(
            (e) =>
              e.type === 'trigger' &&
              e.cycle >= c &&
              e.cycle < c + 1 &&
              (e.value as { s?: string }).s === 'cp',
          )
          .map((e) => (e.type === 'trigger' ? e.cycle - c : -1)),
      boundary,
    ),
  ).toEqual([0.25, 11 / 32, 14 / 32, 0.75]);
  if (process.env.ODM_RHYTHM_SHOTS) {
    await waitForPending(page);
    await page.getByRole('button', { name: 'Boxes', exact: true }).press('Enter');
    for (const [name, width, height] of [
      ['desktop', 1440, 900],
      ['phone', 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.getByLabel('hits', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/rhythm-${name}.png` });
      await page.getByText('Speed and length', { exact: true }).press('Enter');
      await page.getByLabel('Faster ×n', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/rhythm-speed-${name}.png` });
      await page.getByText('Speed and length', { exact: true }).press('Enter');
    }
  }
  await page.getByRole('button', { name: 'Back to plain step', exact: true }).press('Enter');
  await page.keyboard.press('Escape');
  await expect(origin).toBeFocused();
  await page.getByRole('button', { name: 'Stop', exact: true }).press('Enter');
});
