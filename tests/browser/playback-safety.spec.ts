import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { test, openProgram, scoreReady, play, appSignal, throughCycle } from './helpers';
import { FLOOD_MESSAGE, PREFLIGHT_TIMEOUT } from '../../src/engine/playback-limits';
import type {} from '../../src/app/main';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
// The existing paste tests cover an unconditional infinite loop (Play is disabled).
// This passes the score host, then hangs on the scheduler's actual controls/window.
const runaway = 'new Pattern(state => { if (state.controls.cyclist) { while(true){} } return [] })';

test('runaway first Play and Kiln replacement time out together while clicks and old triggers survive', async ({
  page,
  context,
}) => {
  const running = await context.newPage();
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
    await throughCycle(running, cycle + 1);
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
    if (process.env.ODM_SAFETY_SHOTS) {
      await mkdir('test-results/runaway', { recursive: true });
      for (const size of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(size);
        await page.screenshot({
          path: `test-results/runaway/timeout-${size.width}.png`,
          fullPage: true,
        });
      }
    }
    await running.getByRole('button', { name: 'Stop', exact: true }).click();
  } finally {
    await running.close();
  }
});

test('a flood plays bounded synth starts, reports the limit once and still answers clicks', async ({
  page,
}) => {
  await openProgram(page, { source: 's("sine*2048").note(60).release(0.01).gain(0.02)' });
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
  const result = await page.evaluate(() => ({
    errors: window.odmApp.history.filter((e) => e.type === 'error'),
    values: window.odmApp.history.filter((e) => e.type === 'trigger').map((e) => e.value),
  }));
  expect(result.errors).toEqual([{ type: 'error', message: FLOOD_MESSAGE }]);
  expect(result.values.length).toBeGreaterThanOrEqual(64);
  for (const value of result.values) expect(value).toMatchObject({ note: 60, s: 'sine' });
  if (process.env.ODM_SAFETY_SHOTS) {
    await mkdir('test-results/runaway', { recursive: true });
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.screenshot({
        path: `test-results/runaway/flood-${size.width}.png`,
        fullPage: true,
      });
    }
  }
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
