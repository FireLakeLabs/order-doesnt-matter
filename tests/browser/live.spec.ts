import { expect } from '@playwright/test';
import { test, openProgram, play, appSignal } from './helpers';

test('Kiln Now pulses agree with predicted and triggered onsets; Stop and editor focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProgram(page, { example: 'Kiln' });
  const lines = page.locator('[data-live-id]');
  await expect(lines).toHaveCount(6);
  await expect(lines.first()).toContainText('not loaded yet');
  await page.evaluate(() => {
    const first = document.querySelector('[data-live-id]');
    Object.assign(window, { liveFirst: first });
  });
  expect(
    await page.evaluate(() => {
      const dot = document.querySelector('.live-dot')!;
      const row = document.querySelector('tbody th[scope="row"]')!;
      return getComputedStyle(dot).backgroundColor === getComputedStyle(row).borderLeftColor;
    }),
  ).toBe(true);
  await play(page);
  const capture = await page.evaluateHandle(() => {
    const app = window.odmApp;
    const from = app.engine!.now()!,
      to = from + 2;
    const samples: { id: string; cycle: number; frame: number }[] = [];
    let previous = performance.now();
    function frame() {
      const cycle = app.engine!.now()!,
        now = performance.now(),
        gap = (now - previous) / 1000;
      previous = now;
      if (cycle >= from && cycle < to)
        document
          .querySelectorAll<HTMLElement>('[data-lit="true"]')
          .forEach((n) => samples.push({ id: n.dataset.liveId!, cycle, frame: gap }));
      if (cycle < to) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return { from, to, samples };
  });
  await appSignal(
    page,
    (to) => window.odmApp.engine!.now()! >= to,
    await capture.evaluate((c) => c.to),
  );
  const observed = await capture.evaluate((data) => ({
    ...data,
    events: window.odmApp.state.events,
    triggers: window.odmApp.history.filter((e) => e.type === 'trigger'),
    cps: window.odmApp.state.cps!,
    same:
      document.querySelector('[data-live-id]') ===
      (window as unknown as { liveFirst: Element }).liveFirst,
  }));
  await capture.dispose();
  expect(observed.same).toBe(true);
  expect(observed.samples.length).toBeGreaterThan(0);
  let matched = 0;
  // Scheduler queries 0.1 s ahead with 0.05 s overlap; one observed rAF
  // interval is added in cycles. No fixed sleep or assumed equal note grid.
  for (const sample of observed.samples) {
    const tolerance = (0.15 + sample.frame) * observed.cps;
    const predicted = observed.events[sample.id].events.filter(
      (e) =>
        e.whole &&
        e.part[0] === e.whole[0] &&
        e.whole[0] >= observed.from &&
        e.whole[0] < observed.to,
    );
    const note = predicted.find((e) => Math.abs(e.whole![0] - sample.cycle) <= tolerance);
    expect(note, `${sample.id} lit at ${sample.cycle}`).toBeDefined();
    if (
      note &&
      observed.triggers.some(
        (t) =>
          Math.abs(t.cycle - sample.cycle) <= tolerance &&
          JSON.stringify(t.value) === JSON.stringify(note.value),
      )
    )
      matched++;
  }
  expect(matched).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('[data-lit="true"]')).toHaveCount(0);
  await lines.first().click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#live')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(lines.first()).toBeFocused();
});

test('phone strip expands with 44px targets, preserves focus across frames and fits beside editor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openProgram(page, { example: 'Kiln' });
  const summary = page.locator('#live summary');
  await expect(summary).toContainText('Now:');
  await expect(page.locator('#live details')).not.toHaveAttribute('open');
  await summary.click();
  await expect(page.locator('[data-live-id]').nth(4)).toContainText(
    'sits out this section · not loaded yet',
  );
  const line = page.locator('[data-live-id]').first();
  await line.focus();
  await appSignal(page, () => document.activeElement === document.querySelector('[data-live-id]'));
  expect((await line.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page.evaluate(() => {
      const line = document.querySelector<HTMLElement>('[data-live-id]')!;
      line.classList.add('live-playing', 'live-lit');
      const dot = getComputedStyle(line.querySelector('.live-dot')!);
      const steady =
        dot.opacity === '1' && dot.boxShadow === 'none' && dot.transitionDuration === '0s';
      line.classList.remove('live-playing', 'live-lit');
      return steady;
    }),
  ).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(line).toBeFocused();
});
