import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { appSignal } from './helpers';
import { viewSmoke } from './view-smoke';
import type { ViewFrame } from '../../src/views/types';
import type {} from '../../src/studio/main';

viewSmoke(test, 'scope');

declare global {
  interface Window {
    scopeReadCount: number;
    scopeFrames: Record<string, ViewFrame>;
    scopeObserved?: { peakToPeak: number; shared: boolean };
  }
}

test('Studio feeds measured output to Scope, distinguishing no signal from silence', async ({
  page,
  context,
}, info) => {
  await context.route('https://raw.githubusercontent.com/**', (route) => {
    const bank: Record<string, unknown> = {
      _base: 'https://raw.githubusercontent.com/scope-sounds/',
    };
    for (const sound of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      bank[sound] = ['burst.wav', 'burst.wav', 'burst.wav'];
    return route.fulfill({ json: bank });
  });
  await context.route('**/scope-sounds/burst.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
  await page.route('**/assets/scope.view-*.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const name = body.match(/export\{([\w$]+) as default\}/)?.[1];
    if (!name) throw Error('Scope module has no default definition');
    await route.fulfill({
      response,
      body:
        body +
        `
      window.scopeFrames = {};
      const mountScope = ${name}.mount;
      ${name}.mount = (element) => {
        const handle = mountScope(element);
        const stage = element.closest('[data-region]').dataset.region;
        return {
          frame(frame) { window.scopeFrames[stage] = frame; handle.frame(frame); },
          dispose() { delete window.scopeFrames[stage]; handle.dispose(); }
        };
      };
    `,
    });
  });
  await page.goto('/studio.html?inspect&a=scope&b=scope');
  await appSignal(page, () => window.odmStudio.app.canPlay && !!window.scopeFrames?.['stage-a']);
  expect(await page.evaluate(() => window.scopeFrames['stage-a'].audio === undefined)).toBe(true);
  expect(await page.evaluate(() => window.odmStudio.app.engine == null)).toBe(true);
  await page.evaluate(
    (source) => window.odmStudio.load(source),
    await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
  );
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await appSignal(page, () => {
    const a = window.scopeFrames['stage-a']?.audio;
    if (!a) return false;
    const peakToPeak = Math.max(...a.wave) - Math.min(...a.wave);
    if (peakToPeak <= 0.01) return false;
    window.scopeObserved = { peakToPeak, shared: a === window.scopeFrames['stage-b'].audio };
    return true;
  });
  const peakToPeak = await page.evaluate(() => window.scopeObserved!);
  expect(peakToPeak.peakToPeak).toBeGreaterThan(0.01);
  expect(peakToPeak.shared).toBe(true);
  console.log(`Scope delivered wave: peak-to-peak ${peakToPeak.peakToPeak}`);
  await info.attach('scope-delivered-wave', {
    body: JSON.stringify(peakToPeak),
    contentType: 'application/json',
  });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await appSignal(page, () => {
    const wave = window.scopeFrames['stage-a']?.audio?.wave;
    return wave && wave.every((value) => Math.abs(value) < 0.000001);
  });
  expect(await page.evaluate(() => !!window.scopeFrames['stage-a'].audio)).toBe(true);
  await page.getByRole('button', { name: 'Clear Stage A', exact: true }).click();
  await page.getByRole('button', { name: 'Clear Stage B', exact: true }).click();
  await expect(page.locator('[data-scope]')).toHaveCount(0);
  const reads = await page.evaluate(async () => {
    const tap = window.odmStudio.app.engine!.tap();
    const analyse = tap.analyse.bind(tap);
    window.scopeReadCount = 0;
    tap.analyse = () => {
      window.scopeReadCount++;
      return analyse();
    };
    // Synchronize with presented frames, with no wall-clock delay.
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    return window.scopeReadCount;
  });
  expect(reads).toBe(0);
});
