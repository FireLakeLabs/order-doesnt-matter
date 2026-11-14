import { expect } from '@playwright/test';
import { test, openProgram, play, appSignal } from './helpers';
import type {} from '../../src/app/main';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

// Original fixtures pass the worker's preflight unchanged. The last
// diverges only after its four narrow scheduler windows, despite 16 broad cycles.
const topLevel = "if(typeof window !== 'undefined') {while(true){}}; s('sine')";
const microtasks = "if(typeof window !== 'undefined') {while(true){await 0;}}; s('sine')";
const lateQuery = `new Pattern(state => {
  if(state.controls.cyclist && Number(state.span.begin) >= 0.1 &&
     Number(state.span.end) - Number(state.span.begin) < 0.1) {while(true){}}
  return s('sine').query(state);
})`;

test('late authored loops: failed evaluation retains Kiln; late query stops and controls recover', async ({
  page,
}, info) => {
  await openProgram(page, { example: 'Kiln' });
  await play(page);
  for (const source of [topLevel, microtasks]) {
    const rejected = await page.evaluate(async (source) => {
      try {
        await window.odmApp.engine!.play(source);
        return false;
      } catch {
        return true;
      }
    }, source);
    expect(rejected).toBe(true);
    await expect(page.locator('#message')).toHaveText('This program exceeded its execution limit.');
  }
  expect(await page.evaluate(() => window.odmApp.engine!.playing)).toBe(true);
  const mark = await page.evaluate(() => window.odmApp.history.length);
  await appSignal(
    page,
    (mark) => window.odmApp.history.slice(mark!).some((event) => event.type === 'trigger'),
    mark,
  );
  const retained = await page.evaluate(
    (mark) => window.odmApp.history.slice(mark).filter((event) => event.type === 'trigger'),
    mark,
  );
  expect(retained.length).toBeGreaterThan(0);
  expect(retained.every((e) => e.type === 'trigger' && e.revision === 1)).toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();

  // Start at zero after Stop, so preflight cannot see the later narrow query.
  await page.evaluate((source) => window.odmApp.engine!.play(source), lateQuery);
  await appSignal(page, () => !window.odmApp.engine!.playing);
  await expect(page.locator('#message')).toHaveText(
    'This program is taking too long to answer, so playback was stopped.',
  );
  const click = Date.now();
  await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
  await expect(page.getByLabel('Your Strudel program')).toBeHidden();
  const clickMs = Date.now() - click;
  expect(clickMs).toBeLessThan(1000);
  const errors = await page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'error'));
  expect(errors).toEqual([
    { type: 'error', message: 'This program exceeded its execution limit.' },
    { type: 'error', message: 'This program exceeded its execution limit.' },
    {
      type: 'error',
      message: 'This program is taking too long to answer, so playback was stopped.',
    },
  ]);
  console.log('LATE LOOP RECOVERY MEASURED', { clickMs, retainedTriggers: retained.length });
  await page.screenshot({ path: info.outputPath('late-loop-recovered.png'), fullPage: true });
});
