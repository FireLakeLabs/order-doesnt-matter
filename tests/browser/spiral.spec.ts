import { isDeepStrictEqual } from 'node:util';
import { expect } from '@playwright/test';
import { test, openProgram, play, appSignal, sharedProgram } from './helpers';

test.describe('Kiln Watch with shared setup', () => {
  sharedProgram((page) => openProgram(page, { example: 'Kiln' }));
  test('Kiln Watch crosses the gate with engine triggers, keeps past and future, and returns focus without stopping', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await play(page);
    await page.getByRole('button', { name: 'Watch', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const capture = await page.evaluateHandle(() => {
      const app = window.odmApp,
        from = app.engine!.now()!,
        to = from + 2;
      const samples: { id: string; start: number; label: string; cycle: number; frame: number }[] =
        [];
      const seen = new Set<string>();
      let previous = performance.now();
      function frame() {
        const now = app.engine!.now()!,
          clock = performance.now(),
          gap = (clock - previous) / 1000;
        previous = clock;
        for (const m of window.odmSpiral.marks)
          if (m.onset && m.start >= from && m.start <= now && m.start < to && !seen.has(m.id)) {
            seen.add(m.id);
            samples.push({
              id: m.instrument,
              start: m.start,
              label: m.label,
              cycle: now,
              frame: gap,
            });
          }
        if (now < to) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      return { from, to, samples };
    });
    await appSignal(
      page,
      (to) => window.odmApp.engine!.now()! >= to,
      await capture.evaluate((c) => c.to),
    );
    const observed = await capture.evaluate((c) => ({
      ...c,
      cps: window.odmApp.state.cps!,
      events: window.odmApp.state.events,
      triggers: window.odmApp.history.filter((e) => e.type === 'trigger'),
      marks: window.odmSpiral.marks,
      now: window.odmSpiral.cycle,
    }));
    await capture.dispose();
    const expected = Object.entries(observed.events).flatMap(([id, result]) =>
      result.events
        .filter(
          (e) =>
            e.whole &&
            e.part[0] === e.whole[0] &&
            e.whole[0] >= observed.from &&
            e.whole[0] < observed.to,
        )
        .map((e) => ({ id, event: e })),
    );
    expect(observed.samples).toHaveLength(expected.length);
    for (const { id, event } of expected) {
      const sample = observed.samples.find(
        (s) => s.id === id && Math.abs(s.start - event.whole![0]) < 1e-8,
      );
      expect(sample).toBeDefined();
      const tolerance = (0.15 + sample!.frame) * observed.cps;
      expect(Math.abs(sample!.cycle - event.whole![0])).toBeLessThanOrEqual(tolerance);
      expect(
        observed.triggers.some(
          (t) =>
            Math.abs(t.cycle - event.whole![0]) <= tolerance &&
            isDeepStrictEqual(t.value, event.value),
        ),
        JSON.stringify({
          event,
          sample,
          triggers: observed.triggers.filter((t) => Math.abs(t.cycle - event.whole![0]) < 0.02),
        }),
      ).toBe(true);
    }
    const turn = Math.floor(observed.now);
    expect(observed.marks.some((m) => m.turn === turn - 1 && m.opacity > 0 && m.opacity < 1)).toBe(
      true,
    );
    for (const ahead of [1, 2])
      expect(
        observed.marks.filter((m) => m.turn === turn + ahead).every((m) => m.opacity >= 0.4) &&
          observed.marks.some((m) => m.turn === turn + ahead),
      ).toBe(true);
    expect(
      await page.locator('#spiral canvas').evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas
          .getContext('2d')!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        return pixels.some((v, n) => n % 4 === 3 && v > 0);
      }),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Watch', exact: true })).toBeFocused();
    expect(await page.evaluate(() => window.odmApp.engine!.playing)).toBe(true);
  });

  test('phone Watch fits, has touch targets and transport, and reduced motion keeps each turn still', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Watch', exact: true }).click();
    const dialog = page.getByRole('dialog');
    expect(
      await dialog.evaluate(
        (n) => n.scrollWidth <= n.clientWidth && n.scrollHeight <= n.clientHeight,
      ),
    ).toBe(true);
    for (const button of await dialog.getByRole('button').all())
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(
      page.getByRole('img', {
        name: 'Spiral view of the piece; the Now list on the main page says the same in words',
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => {
        const app = window.odmApp,
          view = window.odmSpiral;
        view.update(app.watchInput(0.2));
        const before = view.marks.map((m) => m.startAngle);
        view.update(app.watchInput(0.4));
        return JSON.stringify(before) === JSON.stringify(view.marks.map((m) => m.startAngle));
      }),
    ).toBe(true);
    await dialog.getByRole('button', { name: 'Play', exact: true }).click();
    await appSignal(page, () => window.odmApp.state.playing && window.odmApp.state.message === '');
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click();
    expect(await page.evaluate(() => window.odmApp.engine!.playing)).toBe(false);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Watch', exact: true })).toBeFocused();
  });
});
test('Watch shows unasked time distinctly and cancels its outstanding batch on close', async ({
  page,
}) => {
  await openProgram(page, { source: 's("sawtooth*8")' });
  await page.getByRole('button', { name: 'Watch', exact: true }).click();
  const result = await page.evaluate(() => {
    const app = window.odmApp;
    window.odmSpiral.update(app.watchInput(4));
    return {
      text: document.querySelector('.spiral-status')!.textContent,
      known: app.watchInput(4).known,
    };
  });
  expect(result.text).toBe('Striped stretches: not asked yet');
  expect(result.known).toEqual([[0, 4]]);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.odmApp.watchInput(4).known)).toEqual([[0, 4]]);
});
