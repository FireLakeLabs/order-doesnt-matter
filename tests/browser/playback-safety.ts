import { mkdir } from 'node:fs/promises';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { openProgram, scoreReady, play, appSignal, throughCycle } from './helpers';
import { FLOOD_MESSAGE, PREFLIGHT_TIMEOUT } from '../../src/engine/playback-limits';
import type {} from '../../src/app/main';

// The existing paste tests cover an unconditional infinite loop (Play is disabled).
// This passes the score host, then hangs on the scheduler's actual controls/window.
const runaway = 'new Pattern(state => { if (state.controls.cyclist) { while(true){} } return [] })';

export async function playbackSafety(context: BrowserContext) {
  const page = await context.newPage(),
    running = await context.newPage();
  try {
    await openProgram(running, { example: 'Kiln' });
    await running.getByRole('button', { name: 'Section 2', exact: true }).click();
    await play(running);
    await openProgram(page, { source: runaway });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await appSignal(page, () => !!window.odmApp.engine);
    await running.getByLabel('Your Strudel program').fill(runaway);
    await running.getByRole('button', { name: 'Load', exact: true }).click();
    await scoreReady(running);
    for (const tab of [page, running]) {
      const clicked = Date.now();
      await tab.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
      await expect(tab.getByLabel('Your Strudel program')).toBeHidden();
      expect(
        Date.now() - clicked,
        'click handler answers within one second during preflight',
      ).toBeLessThan(1000);
    }
    await Promise.all(
      [page, running].map((tab) =>
        expect(tab.locator('#message')).toHaveText(PREFLIGHT_TIMEOUT, { timeout: 7000 }),
      ),
    );
    expect(await page.evaluate(() => window.odmApp.engine!.playing)).toBe(false);
    expect(
      await page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'trigger')),
    ).toEqual([]);
    const cycle = await running.evaluate(() => Math.ceil(window.odmApp.engine!.now()!));
    await shots(page, 'timeout');
    // The flood check uses the refused engine while Kiln completes its full cycle.
    await Promise.all([throughCycle(running, cycle + 1), flood(page)]);
    const values = await running.evaluate(
      (from) =>
        window.odmApp.history
          .filter(
            (e): e is Extract<typeof e, { type: 'trigger' }> =>
              e.type === 'trigger' && e.cycle >= from && e.cycle < from + 1,
          )
          .map((e) => e.value),
      cycle,
    );
    expect(values.filter((v) => (v as { s: string }).s === 'bd')).toHaveLength(4);
    expect(values.filter((v) => (v as { s: string }).s === 'hh')).toHaveLength(16);
    expect(values.some((v) => (v as { s: string }).s === 'triangle')).toBe(true);
    expect(await running.evaluate(() => window.odmApp.engine!.playing)).toBe(true);
    expect(
      await running.evaluate(() => window.odmApp.history.filter((e) => e.type === 'error')),
    ).toEqual([{ type: 'error', message: PREFLIGHT_TIMEOUT }]);
    await running.getByRole('button', { name: 'Stop', exact: true }).click();
  } finally {
    await Promise.all([page.close(), running.close()]);
  }
}

async function flood(page: Page) {
  await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
  await page
    .getByLabel('Your Strudel program')
    .fill('s("sine*2048").note(60).release(0.01).gain(0.02)');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await scoreReady(page);
  const before = await page.evaluate(() => window.odmApp.history.length);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#message')).toHaveText(FLOOD_MESSAGE);
  await appSignal(
    page,
    () => window.odmApp.history.filter((e) => e.type === 'trigger').length >= 64,
  );
  const clicked = Date.now();
  await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
  await expect(page.getByLabel('Your Strudel program')).toBeHidden();
  expect(Date.now() - clicked).toBeLessThan(1000);
  expect(await page.evaluate(() => window.odmApp.engine!.playing)).toBe(true);
  const result = await page.evaluate(
    (offset) => ({
      errors: window.odmApp.history.slice(offset).filter((e) => e.type === 'error'),
      values: window.odmApp.history
        .slice(offset)
        .filter((e) => e.type === 'trigger')
        .map((e) => e.value),
    }),
    before,
  );
  expect(result.errors).toEqual([{ type: 'error', message: FLOOD_MESSAGE }]);
  expect(result.values.length).toBeGreaterThanOrEqual(64);
  for (const value of result.values) expect(value).toMatchObject({ note: 60, s: 'sine' });
  await shots(page, 'flood');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
}

async function shots(page: Page, name: string) {
  if (!process.env.ODM_SAFETY_SHOTS) return;
  await mkdir('test-results/runaway', { recursive: true });
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.screenshot({
      path: `test-results/runaway/${name}-${size.width}.png`,
      fullPage: true,
    });
  }
}
