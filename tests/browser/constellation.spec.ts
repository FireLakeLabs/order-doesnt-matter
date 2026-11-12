import { expect } from '@playwright/test';
import { test, appSignal, openProgram, play } from './helpers';
import type { LiveModel } from '../../src/live/model';

test('drawing distinguishes missing, muted, failed and unasked; dense phone uses List', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/harness/live.html');
  await page.evaluate(() => {
    const model: LiveModel = {
      cycle: 1,
      rooms: [],
      instruments: Array.from({ length: 30 }, (_, n) => ({
        id: String(n),
        name: `Instrument ${n}`,
        nameSource: 'generated',
        colour: n,
        noteStarts: n === 3 ? null : n,
        lastOnset: null,
        nextOnset: null,
        room: null,
        inSection: n !== 4,
        silenced: n === 1,
        error: n === 2 ? 'Could not ask this question' : null,
        sound: n === 0 ? 'missing' : 'ready',
      })),
    };
    const update = (
      window as unknown as { setLiveModel(m: LiveModel): (m: LiveModel) => void }
    ).setLiveModel(model);
    // A negative count-in must preserve the stopped section and its states.
    update({
      ...model,
      cycle: -0.01,
      instruments: model.instruments.map((i) => ({
        ...i,
        noteStarts: 0,
        inSection: false,
        sound: 'none',
        error: null,
      })),
    });
  });
  await page.locator('.live-panel > summary').click();
  const planets = page.locator('[data-live-id]');
  await expect(planets).toHaveCount(30);
  await expect(planets.nth(0)).toHaveClass(/live-missing/);
  await expect(planets.nth(0)).toContainText('missing');
  expect(
    await planets
      .nth(0)
      .locator('.live-dot')
      .evaluate((n) => getComputedStyle(n).borderStyle),
  ).toBe('dashed');
  await expect(planets.nth(1)).toHaveClass(/live-hollow/);
  await expect(planets.nth(2)).toContainText('⚠');
  await planets.nth(2).focus();
  await expect(page.locator('.constellation-description')).toContainText(
    'Could not ask this question',
  );
  await expect(page.locator('[data-list-id="2"]')).toContainText('Could not ask this question');
  await expect(planets.nth(3)).toHaveClass(/live-unknown/);
  await expect(planets.nth(3)).not.toHaveClass(/live-absent/);
  await expect(planets.nth(4)).toHaveClass(/live-absent/);
  await expect(page.locator('.live-list-disclosure')).toHaveAttribute('open');
  await expect(page.locator('.constellation-touch-hint')).toBeVisible();
  const sizes = await page.locator('[data-list-id]').evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { width: r.width, height: r.height };
    }),
  );
  expect(sizes.every((r) => r.width >= 44 && r.height >= 44)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('busy real piece fits on desktop and phone without replacing planets on Play', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProgram(page, { path: 'corpus/programs/real-dnb-arranged.strudel' });
  await page.evaluate(() =>
    Object.assign(window, {
      firstPlanet: document.querySelector('[data-live-id]'),
    }),
  );
  await play(page);
  await appSignal(page, () => document.querySelector('[data-lit="true"]'));
  expect(
    await page.evaluate(
      () =>
        document.querySelector('[data-live-id]') ===
        (window as unknown as { firstPlanet: Element }).firstPlanet,
    ),
  ).toBe(true);
  const count = await page.locator('[data-live-id]').count();
  expect(count).toBeGreaterThan(6);
  if (process.env.ODM_CONSTELLATION_SHOTS) {
    await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
    await page.locator('#live').scrollIntoViewIfNeeded();
    await appSignal(page, () => !document.getAnimations().some((a) => a.playState === 'running'));
    await page.screenshot({ path: 'test-results/constellation/real-dnb-1440.png' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // The desktop disclosure remains expanded across a resize.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sizes = await page.locator('[data-live-id]').evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { width: r.width, height: r.height };
    }),
  );
  expect(sizes.every((r) => r.width >= 44 && r.height >= 44)).toBe(true);
  if (process.env.ODM_CONSTELLATION_SHOTS) {
    await page.locator('#live').scrollIntoViewIfNeeded();
    await appSignal(page, () => !document.getAnimations().some((a) => a.playState === 'running'));
    await page.screenshot({ path: 'test-results/constellation/real-dnb-390.png' });
  }
});
