import { expect } from '@playwright/test';
import { test, appSignal, openProgram, play, waitForPending } from './helpers';
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

test('sampled multi-room sends and fourteen full names survive palettes, enlargement and phone disclosure', async ({
  page,
}, info) => {
  const names = Array.from(
    { length: 14 },
    (_, n) => `Original_long_instrument_${n + 1}_ceramic_reflections`,
  );
  names[13] = 'UnbrokenOriginalInstrumentNameForNarrowScreenInspectionFourteen';
  await page.setViewportSize({ width: 390, height: 667 });
  await openProgram(page, {
    source:
      names
        .map(
          (name, n) =>
            `const ${name}=note(${48 + n}).s("sine").room(.2).delay(.3).orbit(${n === 0 ? '"<1 2>"' : (n % 2) + 1});`,
        )
        .join('\n') + `\nstack(${names.join(',')})`,
  });
  await page.locator('.live-panel > summary').click();
  await expect(page.locator('[data-live-id]')).toHaveCount(14);
  await expect(page.locator('[data-list-id]').first()).toContainText('Room 1 + Room 2');
  await expect(page.locator('.live-room-key')).toContainText('Sampled sends');
  const list = page.locator('[data-list-id]'),
    more = page.locator('.live-list-more');
  await expect(more).toHaveText('10 more · 14 total');
  expect(
    await list.evaluateAll(
      (nodes) => nodes.filter((n) => getComputedStyle(n).visibility !== 'hidden').length,
    ),
  ).toBe(4);
  await more.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const held = await page.evaluateHandle(() => ({
    list: Array.from(document.querySelectorAll('[data-list-id]')),
    planets: Array.from(document.querySelectorAll('[data-live-id]')),
    doc: JSON.stringify(window.odmApp.state.doc),
    history: window.odmApp.history.length,
  }));
  const evidence = [];
  for (const theme of ['paper', 'fern', 'night']) {
    await page.getByRole('combobox', { name: 'Theme' }).selectOption(theme);
    for (const size of [
      { width: 390, height: 667 },
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(size);
      for (const expanded of [false, true]) {
        if (expanded) await page.locator('#now-enlarge').press('Enter');
        const measured = await list.evaluateAll((nodes) => ({
          names: nodes.map((n) => n.querySelector('span:not(.live-dot)')!.textContent),
          targets: nodes.map((n) => n.getBoundingClientRect().height),
          fits: document.documentElement.scrollWidth <= innerWidth,
          fullNames: nodes.every((n) => n.scrollWidth <= n.clientWidth),
        }));
        expect(measured.names).toEqual(names);
        expect(measured.targets.every((h) => h >= 44)).toBe(true);
        expect(measured.fits && measured.fullNames).toBe(true);
        await list.last().press('Enter');
        await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'instrument');
        if (expanded) await page.keyboard.press('Escape');
        else
          await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
        await expect(list.last()).toBeFocused();
        const box = (await list.last().boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        evidence.push({ theme, size, expanded, ...measured });
        if (process.env.ODM_CONSTELLATION_SHOTS)
          await page.locator('#now-preview').screenshot({
            path: `${process.env.ODM_CONSTELLATION_SHOTS}/${theme}-${size.width}-${size.height}-${expanded}.png`,
          });
        if (expanded) await page.locator('#preview-close').press('Enter');
      }
    }
  }
  expect(
    await held.evaluate((s) => ({
      list: s.list.every((n, i) => n === document.querySelectorAll('[data-list-id]')[i]),
      planets: s.planets.every((n, i) => n === document.querySelectorAll('[data-live-id]')[i]),
      doc: s.doc === JSON.stringify(window.odmApp.state.doc),
      playing: window.odmApp.state.playing,
      history: s.history === window.odmApp.history.length,
      undo: window.odmApp.editor!.canUndo,
    })),
  ).toEqual({ list: true, planets: true, doc: true, playing: false, history: true, undo: false });
  await page.setViewportSize({ width: 390, height: 667 });
  await more.press('Enter');
  await expect(more).toBeFocused();
  expect(
    await list.evaluateAll(
      (nodes) => nodes.filter((n) => getComputedStyle(n).visibility !== 'hidden').length,
    ),
  ).toBe(4);
  await more.press('Enter');
  await list.last().press('Enter');
  // Context and clock updates must retain the expanded List and origin nodes.
  await page.evaluate(() => {
    window.odmApp.solo(window.odmApp.state.rows[0].id);
    window.odmApp.solo(null);
  });
  await page.keyboard.press('Escape');
  await expect(list.last()).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  // An actual edit/Undo while playing keeps the same full-name origin too.
  await list.last().press('Enter');
  await play(page);
  await page.getByLabel('Instrument name', { exact: true }).fill('Original renamed instrument');
  await page.locator('#editor').getByRole('button', { name: 'Rename', exact: true }).click();
  await waitForPending(page);
  await expect(list.last()).toContainText('Original renamed instrument');
  await page.locator('#undo').click();
  await waitForPending(page);
  await expect(list.last()).toContainText(names[13]);
  await page
    .locator('#editor')
    .getByRole('button', { name: 'Edit as source', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Source text', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list.last()).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  expect(
    await held.evaluate(
      (s) =>
        s.doc === JSON.stringify(window.odmApp.state.doc) &&
        s.list[13] === document.querySelectorAll('[data-list-id]')[13],
    ),
  ).toBe(true);
  await page.locator('#stop').click();
  await list.last().focus();
  await more.evaluate((n: HTMLButtonElement) => n.click());
  await expect(more).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  const planet = page.locator('[data-live-id]').last();
  await planet.press('Enter');
  await page.keyboard.press('Escape');
  await expect(planet).toBeFocused();
  await held.dispose();
  await info.attach('multi-room-list-geometry', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
});
