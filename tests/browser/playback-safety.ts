import { mkdir } from 'node:fs/promises';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { openProgram, scoreReady, play, appSignal, throughCycle } from './helpers';
import {
  FLOOD_MESSAGE,
  MAX_WINDOW_STARTS,
  PREFLIGHT_TIMEOUT,
} from '../../src/engine/playback-limits';
import type {} from '../../src/app/main';

// The existing paste tests cover an unconditional infinite loop (Play is disabled).
// This passes the score host, then hangs on the scheduler's actual controls/window.
const runaway = 'new Pattern(state => { if (state.controls.cyclist) { while(true){} } return [] })';

export async function playbackSafety(context: BrowserContext) {
  const [page, running] = await Promise.all([context.newPage(), context.newPage()]);
  try {
    await Promise.all([
      openProgram(running, { example: 'Kiln' }),
      openProgram(page, { source: runaway }),
    ]);
    await running.getByRole('button', { name: 'Section 2', exact: true }).click();
    await Promise.all([
      play(running),
      page.getByRole('button', { name: 'Play', exact: true }).click(),
    ]);
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
    const cdp = await context.newCDPSession(running);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const errorMark = await running.evaluate(() => window.odmApp.history.length);
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
    expect(
      await running.evaluate(
        (offset) => window.odmApp.history.slice(offset).filter((e) => e.type === 'error'),
        errorMark,
      ),
    ).toEqual([]);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await running.getByRole('button', { name: 'Stop', exact: true }).click();
  } finally {
    await Promise.all([page.close(), running.close()]);
  }
}

async function flood(page: Page) {
  await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
  await page.getByLabel('Your Strudel program').fill(
    `note("[${Array(MAX_WINDOW_STARTS + 1)
      .fill(60)
      .join(',')}]").s("sine").clip(0.001).release(0.005).gain(0.0002)`,
  );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await scoreReady(page);
  await page.evaluate((message) => {
    const errors: unknown[] = [],
      values: unknown[] = [];
    const off = window.odmApp.engine!.subscribe((e) => {
      if (e.type === 'trigger') values.push(e.value);
      if (e.type === 'error') errors.push(e);
      if (e.type !== 'error' || e.message !== message) return;
      const start = performance.now();
      setTimeout(() => {
        document.getElementById('paste')!.click();
        off();
        performance.measure('ODM:cap-click', {
          start,
          end: performance.now(),
          detail: { errors, values, playing: window.odmApp.engine!.playing },
        });
      }, 0);
    });
  }, FLOOD_MESSAGE);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#message')).toHaveText(FLOOD_MESSAGE);
  await appSignal(page, () => performance.getEntriesByName('ODM:cap-click').length > 0);
  await expect(page.getByLabel('Your Strudel program')).toBeHidden();
  const result = await page.evaluate(() => {
    const entry = performance.getEntriesByName('ODM:cap-click')[0] as PerformanceMeasure;
    return {
      clickMs: entry.duration,
      ...(entry.detail as { errors: unknown[]; values: unknown[]; playing: boolean }),
    };
  });
  console.log('CAP RESPONSIVENESS MEASURED', { cap: MAX_WINDOW_STARTS, clickMs: result.clickMs });
  expect(result.clickMs).toBeLessThan(1000);
  expect(result.playing).toBe(true);
  await expect(page.locator('#message')).toHaveAttribute('data-kind', 'warning');
  expect(await page.evaluate(() => window.odmApp.engine!.playing)).toBe(true);
  expect(result.errors).toEqual([
    { type: 'error', message: FLOOD_MESSAGE, reason: 'notes-left-out' },
  ]);
  expect(result.values).toHaveLength(MAX_WINDOW_STARTS);
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
