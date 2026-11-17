import { mkdir } from 'node:fs/promises';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { openProgram, scoreReady, play, appSignal, throughCycle } from './helpers';
import {
  FLOOD_MESSAGE,
  MAX_WINDOW_STARTS,
  PREFLIGHT_TIMEOUT,
} from '../../src/engine/playback-limits';
import type {} from '../../src/app/main';
import type { EngineEvent } from '../../src/contract';

type Note = { cycle: number; value: unknown };
declare global {
  interface Window {
    odmSafetyScheduled: Note[];
  }
}

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
    // Observe real scheduler questions before the guard/output path. Late windows
    // never queried by Cyclist are absent from both sides; a dropped real onset
    // inside an answered window still fails exact equality below.
    const capture = await running.evaluateHandle(async () => {
      const app = window.odmApp;
      window.odmSafetyScheduled = [];
      const delivered: Extract<EngineEvent, { type: 'trigger' }>[] = [];
      const off = app.engine!.subscribe((e) => {
        if (e.type === 'trigger') delivered.push(e);
      });
      const revision = await app.engine!.play(`all(p => new Pattern(state => {
  const haps = p.query(state);
  if (globalThis.odmSafetyScheduled && state.controls.cyclist) {
    for (const hap of haps) if (hap.hasOnset())
      window.odmSafetyScheduled.push({ cycle: Number(hap.whole.begin), value: { ...hap.value } });
  }
  return haps;
}));
${app.exportStrudel()}`);
      return { revision, delivered, off };
    });
    await running.getByLabel('Your Strudel program').fill(runaway);
    await running.getByRole('button', { name: 'Load', exact: true }).click();
    await scoreReady(running);
    for (const tab of [page, running]) {
      await tab.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
      await expect(tab.getByLabel('Your Strudel program')).toBeHidden();
    }
    await Promise.all(
      [page, running].map((tab) =>
        appSignal(
          tab,
          (message) => document.getElementById('message')!.textContent === message,
          PREFLIGHT_TIMEOUT,
        ),
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
    // Cover repeated Kiln positions while another tab floods. Require delivery
    // of every onset in every answered window, without demanding one lucky cycle
    // in which a shared runner never skips a scheduler question.
    await flood(page);
    const end = await running.evaluate(
      (minimum) => Math.max(minimum, Math.ceil(window.odmApp.engine!.now()!)),
      cycle + 2,
    );
    await throughCycle(running, end);
    const notes = await capture.evaluate((capture, end) => {
      capture.off();
      const inside = (note: Note) => note.cycle < end;
      return {
        scheduled: window.odmSafetyScheduled.filter(inside),
        delivered: capture.delivered
          .filter((e) => e.revision === capture.revision && inside(e))
          .map(({ cycle, value }) => ({ cycle, value })),
      };
    }, end);
    await capture.dispose();
    const order = (a: Note, b: Note) =>
      a.cycle - b.cycle || JSON.stringify(a.value).localeCompare(JSON.stringify(b.value));
    expect(notes.delivered.sort(order)).toEqual(notes.scheduled.sort(order));
    const positions = (sound: string) =>
      [
        ...new Set(
          notes.delivered
            .filter((e) => (e.value as { s: string }).s === sound)
            .map((e) => e.cycle % 1),
        ),
      ].sort((a, b) => a - b);
    expect(positions('bd')).toEqual([0, 0.25, 0.5, 0.75]);
    expect(positions('hh')).toEqual(Array.from({ length: 16 }, (_, i) => i / 16));
    expect(notes.delivered.some((e) => (e.value as { s: string }).s === 'triangle')).toBe(true);
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
  await appSignal(
    page,
    (message) => document.getElementById('message')!.textContent === message,
    FLOOD_MESSAGE,
  );
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
