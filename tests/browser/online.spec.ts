import { expect, test } from '@playwright/test';
import type {} from '../../src/app/main';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
test('online default drums: bd, hh and cp each load and render isolated PCM', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.ODM_BROWSER_MODE !== 'online',
    'Local online mode only: npm run test:browser:online',
  );
  test.skip(!!process.env.CI, 'Online samples are never fetched in CI');
  try {
    const probe = await request.get(
      'https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json',
      { timeout: 6500 },
    );
    test.skip(!probe.ok(), 'Offline: default sample host unavailable');
  } catch {
    test.skip(true, 'Offline: default sample host unavailable');
  }
  await page.goto('/?inspect');
  await page.getByLabel('Your Strudel program').fill('s("bd*2, hh*4, ~ cp")');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  for (const drum of ['bd', 'hh', 'cp'])
    await expect(page.getByText(`${drum}: ready`, { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const measured = await page.evaluate(async () => {
    const app = window.odmApp,
      e = app.engine!,
      tap = e.tap();
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const results = [];
    for (const drum of ['bd', 'hh', 'cp']) {
      // Allow previous voices to end; the two other instruments have no events.
      await sleep(900);
      const background = await tap.rms(e.audioTime() - 0.12, e.audioTime() - 0.02);
      app.history.length = 0;
      await e.play(`stack(s("${drum}*4"),s("~"),s("~"))`);
      const deadline = performance.now() + 5000;
      while (!app.history.some((t) => t.type === 'trigger')) {
        if (performance.now() > deadline) throw Error('No isolated drum trigger');
        await sleep(10);
      }
      const trigger = app.history.find((t) => t.type === 'trigger')!;
      const rms = await tap.rms(trigger.time + 0.005, trigger.time + 0.105);
      results.push({ drum, background, rms, triggerTime: trigger.time, sounds: e.sounds() });
      e.stop();
    }
    return results;
  });
  for (const result of measured) {
    console.log('ONLINE DRUM MEASURED (rendered PCM, threshold 0.001)', JSON.stringify(result));
    expect(result.sounds).toContainEqual({ name: result.drum, state: 'ready' });
    expect(result.rms).toBeGreaterThan(0.001);
    expect(result.rms).toBeGreaterThan(result.background * 10);
  }
});
