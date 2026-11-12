import { mkdir, writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { test, openProgram, play, scoreReady, appSignal, signal } from './helpers';

test('Kiln Watch view sliders work by keyboard, fit a phone and survive reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProgram(page, { example: 'Kiln' });
  expect(await page.evaluate(() => window.odmApp.watchInput(null).outputLatency)).toBe(0);
  const watch = page.getByRole('button', { name: 'Watch', exact: true });
  await watch.click();
  await page.locator('.spiral-controls > summary').click();
  const keep = page.getByRole('slider', { name: 'Keep what just played' });
  const ahead = page.getByRole('slider', { name: "Show what's coming" });
  await expect(keep).toHaveValue('1');
  await expect(ahead).toHaveValue('2');
  if (process.env.ODM_LIVE_SHOTS) {
    await mkdir('test-results/live-polish', { recursive: true });
    await page.screenshot({ path: 'test-results/live-polish/watch-open-390.png' });
    await page.locator('.spiral-controls > summary').click();
    await page.screenshot({ path: 'test-results/live-polish/watch-closed-390.png' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: 'test-results/live-polish/watch-closed-1440.png' });
    await page.locator('.spiral-controls > summary').click();
    await page.screenshot({ path: 'test-results/live-polish/watch-open-1440.png' });
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await keep.focus();
  await keep.press('End');
  await ahead.focus();
  await ahead.press('End');
  for (const slider of [keep, ahead])
    expect((await slider.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page
      .getByRole('dialog')
      .evaluate((n) => n.scrollWidth <= n.clientWidth && n.scrollHeight <= n.clientHeight),
  ).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Kiln', exact: true }).click();
  await scoreReady(page);
  await watch.click();
  await expect(page.locator('.spiral-controls')).not.toHaveAttribute('open');
  await page.locator('.spiral-controls > summary').click();
  await expect(keep).toHaveValue('2');
  await expect(ahead).toHaveValue('4');
  // Maximum preview really reaches the fourth upcoming turn; minimum removes it.
  const last = await page.evaluate(() => {
    window.odmSpiral.update(window.odmApp.watchInput(0));
    return Math.max(...window.odmSpiral.marks.map((m) => m.turn));
  });
  expect(last).toBeGreaterThanOrEqual(3); // held notes; any further time is honestly unasked
  expect(last).toBeLessThanOrEqual(4);
  await ahead.press('Home');
  expect(await page.evaluate(() => Math.max(...window.odmSpiral.marks.map((m) => m.turn)))).toBe(1);
  await page.evaluate(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    }),
  );
  await keep.press('Home');
  await expect(keep).toHaveValue('0.1');
  await page.keyboard.press('Escape');
  await expect(page.locator('input[type="range"]')).toHaveCount(0);
});

test('denied storage keeps Watch usable; reduced motion keeps a strong unclipped planet ring', async ({
  page,
}) => {
  test.skip(!process.env.ODM_LIVE_SHOTS, 'Screenshot and denied-storage visual review');
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openProgram(page, { example: 'Kiln' });
  await page.getByRole('button', { name: 'Section 3', exact: true }).click();
  await page.getByRole('button', { name: 'Watch', exact: true }).click();
  await page.locator('.spiral-controls > summary').click();
  await page.getByRole('slider', { name: 'Keep what just played' }).press('End');
  await expect(page.getByRole('slider', { name: 'Keep what just played' })).toHaveValue('2');
  await page.keyboard.press('Escape');
  await play(page);
  const mark = await page
    .locator('.constellation-planet.live-playing .live-dot')
    .first()
    .evaluate((n) => {
      const ring = getComputedStyle(n, '::after'),
        dot = n.getBoundingClientRect(),
        box = n.closest('.constellation')!.getBoundingClientRect();
      return {
        opacity: ring.opacity,
        display: ring.display,
        border: ring.borderTopWidth,
        fits:
          dot.left - 9 >= box.left &&
          dot.right + 9 <= box.right &&
          dot.top - 9 >= box.top &&
          dot.bottom + 9 <= box.bottom,
      };
    });
  expect(mark).toEqual({ opacity: '1', display: 'block', border: '3px', fits: true });
  if (process.env.ODM_LIVE_SHOTS) {
    await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
    await mkdir('test-results/live-polish', { recursive: true });
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      if (!(await page.locator('.live-panel').evaluate((n) => (n as HTMLDetailsElement).open)))
        await page.locator('.live-panel > summary').click();
      await page.locator('#live').scrollIntoViewIfNeeded();
      await appSignal(page, () => !document.getAnimations().some((a) => a.playState === 'running'));
      await page.screenshot({ path: `test-results/live-polish/now-${width}.png` });
    }
  }
});

test('opt-in: 100 Kiln trigger clocks versus Watch gate and Now flash, plus 300 draw frames', async ({
  page,
  browser,
}) => {
  test.skip(!process.env.ODM_LIVE_MEASURE, 'Local clock and draw measurement');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        Object.assign(window, { measuredAudioContext: this });
      }
    };
  });
  // Real sample downloads are needed here: count only triggers whose sound is ready.
  await openProgram(page, { example: 'Kiln', offline: false });
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  await play(page);
  await page.getByRole('button', { name: 'Watch', exact: true }).click();
  const capture = await page.evaluateHandle(() => {
    const app = window.odmApp,
      engine = app.engine!,
      context = (window as unknown as { measuredAudioContext: AudioContext }).measuredAudioContext;
    const latency = context.baseLatency + (context.outputLatency ?? 0);
    const rows: {
      id: string;
      cycle: number;
      time: number;
      target: number;
      ahead: number;
      gate?: number;
      flash?: number;
    }[] = [];
    const key = (v: unknown) => JSON.stringify(v, Object.keys(v as object).sort());
    const off = engine.subscribe((e) => {
      if (e.type !== 'trigger' || rows.length >= 100) return;
      const sound = (e.value as { s?: string }).s;
      if (!engine.sounds().some((s) => s.name === sound && s.state === 'ready')) return;
      const id = Object.entries(app.watchInput(e.cycle).events).find(([, r]) =>
        r.events.some(
          (n) => n.whole && Math.abs(n.whole[0] - e.cycle) < 1e-8 && key(n.value) === key(e.value),
        ),
      )?.[0];
      if (!id) throw Error('Trigger could not be attributed to its held score');
      const wall = performance.now(),
        audio = engine.audioTime();
      rows.push({
        id,
        cycle: e.cycle,
        time: e.time,
        target: wall + (e.time + latency - audio) * 1000,
        ahead: (e.time - audio) * 1000,
      });
    });
    let done = false;
    function frame() {
      const wall = performance.now();
      for (const r of rows) {
        if (
          r.gate === undefined &&
          window.odmSpiral.cycle >= r.cycle &&
          window.odmSpiral.marks.some(
            (m) => m.onset && m.instrument === r.id && Math.abs(m.start - r.cycle) < 1e-8,
          )
        )
          r.gate = wall;
        if (
          r.flash === undefined &&
          engine.now()! >= r.cycle &&
          document.querySelector<HTMLElement>(`[data-live-id="${r.id}"]`)?.dataset.lit === 'true'
        )
          r.flash = wall;
      }
      done =
        rows.length === 100 && rows.every((r) => r.gate !== undefined && r.flash !== undefined);
      if (done) off();
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return {
      rows,
      engineLatency: engine.outputLatency(),
      baseLatency: context.baseLatency,
      outputLatency: context.outputLatency,
      sampleRate: context.sampleRate,
      get done() {
        return done;
      },
    };
  });
  await signal(() => capture.evaluate((c) => c.done)).toBe(true);
  const result = await capture.evaluate((c) => ({ ...c, rows: c.rows }));
  await capture.dispose();
  const stats = (values: number[]) => {
    const v = values.toSorted((a, b) => a - b);
    return {
      median: (v[49] + v[50]) / 2,
      p90: v[89],
      worst: v.reduce((a, b) => (Math.abs(a) > Math.abs(b) ? a : b)),
    };
  };
  const report = {
    ...result,
    browser: browser.version(),
    gateMs: stats(result.rows.map((r) => r.gate! - r.target)),
    flashMs: stats(result.rows.map((r) => r.flash! - r.target)),
    scheduledAheadMs: stats(result.rows.map((r) => r.ahead)),
    definition:
      'Positive = view late. Audio target = scheduled engine time + baseLatency + outputLatency, mapped to performance.now at dispatch. Browser-reported latency, not a speaker measurement.',
  };
  expect(result.engineLatency).toBeCloseTo(result.baseLatency + (result.outputLatency ?? 0), 12);
  expect(result.rows).toHaveLength(100);
  expect(result.rows.every((r) => Number.isFinite(r.gate) && Number.isFinite(r.flash))).toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).last().click();
  await page.goto('/harness/spiral.html');
  const draw = await page.evaluate(() =>
    (
      window as unknown as {
        odmSpiralHarness: { measure(): Promise<unknown> };
      }
    ).odmSpiralHarness.measure(),
  );
  await mkdir('test-results/live-polish', { recursive: true });
  await writeFile(
    'test-results/live-polish/measurement.json',
    JSON.stringify({ ...report, draw, compensated: true }, null, 2),
  );
  console.log(
    JSON.stringify({
      gateMs: report.gateMs,
      flashMs: report.flashMs,
      scheduledAheadMs: report.scheduledAheadMs,
      baseLatency: result.baseLatency,
      outputLatency: result.outputLatency,
      draw,
    }),
  );
});
