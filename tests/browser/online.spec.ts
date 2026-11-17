import { play, openProgram } from './helpers';
import { expect, test } from '@playwright/test';
import type {} from '../../src/studio/main';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
for (const drum of ['bd', 'hh', 'cp'])
  test(`online ${drum}: loads and renders isolated PCM`, async ({ page, request }) => {
    test.skip(
      process.env.ODM_BROWSER_MODE !== 'online',
      'Local online mode only: npm run test:browser:online',
    );
    test.skip(!!process.env.CI, 'Online samples are never fetched in CI');
    try {
      const probe = await request.get(
        'https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json',
        { timeout: test.info().timeout },
      );
      test.skip(!probe.ok(), 'Offline: default sample host unavailable');
    } catch {
      test.skip(true, 'Offline: default sample host unavailable');
    }
    // Preserve the combined default-bank readiness check, then navigate to a
    // fresh document so no prior voice can contaminate the isolated PCM window.
    await openProgram(page, { source: 's("bd*2, hh*4, ~ cp")', offline: false });
    await play(page);
    for (const name of ['bd', 'hh', 'cp'])
      await expect(page.getByText(`${name}: ready`, { exact: true })).toBeVisible();
    await openProgram(page, {
      source: `stack(s("${drum}*4"),s("~"),s("~"))`,
      offline: false,
    });
    await play(page);
    await expect(page.getByText(`${drum}: ready`, { exact: true })).toBeVisible();
    const measured = await page.evaluate(async (drum) => {
      const app = window.odmStudio.app,
        e = app.engine!,
        tap = e.tap();
      const trigger = app.history.find((t) => t.type === 'trigger')!;
      const background = await tap.rms(trigger.time - 0.12, trigger.time - 0.02);
      const rms = await tap.rms(trigger.time + 0.005, trigger.time + 0.105);
      e.stop();
      return [{ drum, background, rms, triggerTime: trigger.time, sounds: e.sounds() }];
    }, drum);
    for (const result of measured) {
      console.log('ONLINE DRUM MEASURED (rendered PCM, threshold 0.001)', JSON.stringify(result));
      expect(result.sounds).toContainEqual({ name: result.drum, state: 'ready' });
      expect(result.rms).toBeGreaterThan(0.001);
      expect(result.rms).toBeGreaterThan(result.background * 10);
    }
  });
