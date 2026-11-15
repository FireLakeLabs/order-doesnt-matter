import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type {} from '../../src/studio/main';
import type { EngineEvent } from '../../src/contract';

const shots = '/tmp/odm-studio-transport';
async function load(page: Page, piece = 'real-dubstep-arranged') {
  await page.context().route('https://raw.githubusercontent.com/**', (route) =>
    route.fulfill({
      json: {
        _base: 'https://assets.invalid/',
        ade: ['burst.wav'],
        bd: ['burst.wav'],
        sd: ['burst.wav'],
        hh: ['burst.wav'],
        oh: ['burst.wav'],
        cp: ['burst.wav'],
        speech: ['burst.wav'],
      },
    }),
  );
  await page
    .context()
    .route('https://assets.invalid/burst.wav', (route) =>
      route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
    );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/studio.html?inspect');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
    },
    await readFile(`corpus/programs/${piece}.strudel`, 'utf8'),
  );
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.odmStudio.app.state.playing && window.odmStudio.app.canPlay,
  );
}
async function revisionAt(page: Page, cycle: number) {
  return page.evaluate(async (cycle) => {
    await window.odmStudio.seek(cycle);
    return Math.max(
      ...window.odmStudio.app.history
        .filter((event) => event.type === 'swapped')
        .map((event) => event.revision),
    );
  }, cycle);
}
async function passage(page: Page) {
  const revision = await revisionAt(page, 8);
  await page.waitForFunction(
    (revision) =>
      window.odmStudio.app.history.some(
        (e): e is Extract<EngineEvent, { type: 'trigger' }> =>
          e.type === 'trigger' && e.revision === revision && e.cycle >= 10,
      ),
    revision,
  );
  return page.evaluate(
    (revision) =>
      window.odmStudio.app.history.filter(
        (e): e is Extract<EngineEvent, { type: 'trigger' }> =>
          e.type === 'trigger' && e.revision === revision && e.cycle >= 8 && e.cycle < 10,
      ),
    revision,
  );
}

test('Studio real arrangement: half-speed trigger rate, live seek, scrub and beat stepping', async ({
  page,
}) => {
  await load(page);
  const document = await page.evaluate(() => window.odmStudio.app.exportStrudel());
  const full = await passage(page);
  const beforeSpeed = await page.evaluate(() => ({
    cycle: window.odmStudio.getPlayhead(),
    transports: window.odmStudio.app.history.filter((e) => e.type === 'transport').length,
  }));
  await page.getByRole('button', { name: 'Speed 0.5', exact: true }).click();
  const afterSpeed = await page.evaluate(() => ({
    cycle: window.odmStudio.getPlayhead(),
    transports: window.odmStudio.app.history.filter((e) => e.type === 'transport').length,
  }));
  expect(afterSpeed.cycle).toBeGreaterThanOrEqual(beforeSpeed.cycle);
  expect(afterSpeed.cycle).toBeLessThan(beforeSpeed.cycle + 0.5);
  expect(afterSpeed.transports).toBe(beforeSpeed.transports);
  await expect(page.locator('.tempo')).toContainText('written at 140');
  const half = await passage(page);
  expect(half.map((e) => [e.cycle, e.value])).toEqual(full.map((e) => [e.cycle, e.value]));
  const span = (events: typeof full) => events.at(-1)!.time - events[0].time;
  const ratio = span(full) / span(half);
  expect(ratio).toBeGreaterThan(0.475);
  expect(ratio).toBeLessThan(0.525);
  for (let i = 0; i < full.length; i++)
    expect(half[i].time - half[0].time).toBeCloseTo((full[i].time - full[0].time) * 2, 4);
  expect(await page.evaluate(() => window.odmStudio.app.exportStrudel())).toBe(document);
  const revision = await revisionAt(page, 16);
  await page.waitForFunction(
    (revision) =>
      window.odmStudio.app.history.some(
        (e): e is Extract<EngineEvent, { type: 'trigger' }> =>
          e.type === 'trigger' && e.revision === revision && e.cycle >= 16.5,
      ),
    revision,
  );
  const breakdown = await page.evaluate(
    (revision) =>
      window.odmStudio.app.history.filter(
        (e): e is Extract<EngineEvent, { type: 'trigger' }> =>
          e.type === 'trigger' && e.revision === revision,
      ),
    revision,
  );
  expect(breakdown.length).toBeGreaterThan(0);
  expect(
    breakdown.every((e) =>
      ['supersaw', 'ade', 'triangle'].includes(String((e.value as { s: string }).s)),
    ),
  ).toBe(true);
  const track = (await page.getByTestId('song-track').boundingBox())!;
  const knob = page.getByTestId('playhead-knob');
  const grip = (await knob.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  expect(await page.evaluate(() => window.odmStudio.transport.getSnapshot().scrubbing)).toBe(true);
  const before = await page.evaluate(
    () =>
      window.odmStudio.app.history.filter(
        (e): e is Extract<EngineEvent, { type: 'trigger' }> => e.type === 'trigger',
      ).length,
  );
  const tracking: number[] = [];
  for (const cycle of [0, 2, 6, 12, 28, 18]) {
    await page.mouse.move(track.x + (track.width * cycle) / 28, track.y + 30);
    // Read synchronously after the pointer event, without waiting for a frame.
    const actual = await page.evaluate(() => window.odmStudio.getPlayhead());
    tracking.push(actual);
    expect(actual).toBeCloseTo(cycle, 1);
  }
  const silence = await page.evaluate(async () => {
    const engine = window.odmStudio.app.engine!;
    const from = engine.audioTime() + 0.02;
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (engine.audioTime() >= from + 0.15) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });
    return engine.tap().rms(from, from + 0.1);
  });
  expect(
    silence,
    'Superdough orbit/bus hush canary: queued notes and tails must be silent',
  ).toBeLessThan(0.000001);
  expect(
    await page.evaluate(
      () =>
        window.odmStudio.app.history.filter(
          (e): e is Extract<EngineEvent, { type: 'trigger' }> => e.type === 'trigger',
        ).length,
    ),
  ).toBe(before);
  await page.mouse.up();
  await page.waitForFunction(() => window.odmStudio.app.state.playing);
  expect(await page.evaluate(() => window.odmStudio.getPlayhead())).toBeGreaterThan(17.8);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(async () => {
    await window.odmStudio.seek(8);
  });
  for (let i = 0; i < 4; i++)
    await page.getByRole('button', { name: 'Step forward one beat', exact: true }).click();
  expect(await page.evaluate(() => window.odmStudio.getPlayhead())).toBe(9);
  await page.getByRole('button', { name: 'Step back one beat', exact: true }).click();
  expect(await page.evaluate(() => window.odmStudio.getPlayhead())).toBe(8.75);
  await mkdir(shots, { recursive: true });
  await writeFile(
    `${shots}/timing.json`,
    JSON.stringify(
      {
        triggersPerPass: full.length,
        fullSeconds: span(full),
        halfSeconds: span(half),
        rateRatio: ratio,
        pointerPlayheads: tracking,
        scrubRms: silence,
      },
      null,
      2,
    ),
  );
});

test('Studio whole-cycle loop repeats boundary notes exactly, clears in place and fits all themes', async ({
  page,
}) => {
  await load(page);
  await page.evaluate(async () => {
    await window.odmStudio.seek(8);
  });
  const rect = (await page.getByTestId('song-track').boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.move(rect.x + (rect.width * 8) / 28, rect.y + 20);
  await page.mouse.down();
  await page.mouse.move(rect.x + (rect.width * 10) / 28, rect.y + 20);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForFunction(() => window.odmStudio.transport.getSnapshot().loop?.to === 10);
  await expect(page.getByTestId('loop-range')).toBeVisible();
  const revision = await revisionAt(page, 8);
  await page.waitForFunction((revision) => {
    const events = window.odmStudio.app.history.filter(
      (e): e is Extract<EngineEvent, { type: 'trigger' }> =>
        e.type === 'trigger' && e.revision === revision,
    );
    return events.length > 0 && events.at(-1)!.time - events[0].time >= 6 / (140 / 240) - 0.001;
  }, revision);
  const events = await page.evaluate(
    (revision) =>
      window.odmStudio.app.history.filter(
        (e): e is Extract<EngineEvent, { type: 'trigger' }> =>
          e.type === 'trigger' && e.revision === revision,
      ),
    revision,
  );
  events.sort(
    (a, b) => a.time - b.time || JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)),
  );
  const period = 2 / (140 / 240);
  const passes = [0, 1, 2].map((pass) =>
    events
      .filter(
        (e) =>
          e.time >= events[0].time + pass * period - 0.00001 &&
          e.time < events[0].time + (pass + 1) * period - 0.00001,
      )
      .map((e) => ({ cycle: e.cycle, value: e.value })),
  );
  expect(passes[0]).toHaveLength(28);
  expect(
    new Set(events.map((event) => JSON.stringify([event.cycle, event.value, event.time]))).size,
  ).toBe(events.length);
  expect(passes[1]).toEqual(passes[0]);
  expect(passes[2]).toEqual(passes[0]);
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => window.odmStudio.getPlayhead());
    expect(now).toBeGreaterThanOrEqual(8);
    expect(now).toBeLessThan(10);
  }
  const before = await page.evaluate(() => window.odmStudio.getPlayhead());
  await page.getByRole('button', { name: 'Clear loop', exact: true }).click();
  await page.waitForFunction(() => window.odmStudio.transport.getSnapshot().loop === null);
  const after = await page.evaluate(() => window.odmStudio.getPlayhead());
  expect(after).toBeGreaterThan(before - 0.2);
  expect(after).toBeLessThan(before + 0.6);
  await page.getByRole('button', { name: 'Speed 0.5', exact: true }).click();
  await page.evaluate(async () => {
    await window.odmStudio.setLoop({ from: 8, to: 10 });
  });
  await mkdir(shots, { recursive: true });
  for (const [theme, width, height] of [
    ['arcade', 1920, 1080],
    ['arcade', 2560, 1440],
    ['phosphor', 1920, 1080],
    ['riso', 1920, 1080],
    ['sunset', 1920, 1080],
    ['pocket', 1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(
          document.querySelector('[data-region="top-bar"]')!.getAnimations({ subtree: true }),
          (animation) => animation.finished,
        ),
      );
    });
    await expect(page.getByTestId('loop-range')).toBeVisible();
    expect((await page.locator('[data-region="top-bar"]').boundingBox())!.height).toBe(52);
    expect((await page.locator('[data-region="scrub-strip"]').boundingBox())!.height).toBe(56);
    expect((await page.getByTestId('playhead-knob').boundingBox())!.width).toBeGreaterThanOrEqual(
      24,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: `${shots}/${theme}-${String(width)}x${String(height)}.png` });
  }
  await writeFile(
    `${shots}/loop.json`,
    JSON.stringify({ triggersPerPass: passes[0].length, period, passes }, null, 2),
  );
});

test('Studio endless techno pages: silent paused scrub, far seek, steps and later pages', async ({
  page,
}) => {
  await load(page, 'real-techno');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('.song-hint')).toContainText('continues');
  const rect = (await page.getByTestId('song-track').boundingBox())!;
  await page.mouse.move(rect.x + rect.width * 0.5, rect.y + 30);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.75, rect.y + 30);
  expect(await page.evaluate(() => window.odmStudio.getPlayhead())).toBeCloseTo(12, 1);
  await page.mouse.up();
  expect(await page.evaluate(() => window.odmStudio.app.state.playing)).toBe(false);
  await page.evaluate(async () => {
    await window.odmStudio.seek(100);
  });
  await expect(page.locator('.song-block').first()).toContainText('96');
  await page.getByRole('button', { name: 'Step forward one beat', exact: true }).click();
  expect(await page.evaluate(() => window.odmStudio.getPlayhead())).toBe(100.25);
});
