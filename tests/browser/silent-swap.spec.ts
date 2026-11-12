import { test } from './helpers';
import { expect } from '@playwright/test';
import type { EngineEvent } from '../../src/contract';
import type {} from '../../src/engine/harness';
import {
  openProgram,
  play,
  selectNode,
  signal,
  installEngineSignals,
  waitForPending,
} from './helpers';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
const BOUND_MS = 3000;
for (const code of [
  'silence',
  'note(60).s("sine").degradeBy(1)',
  'note("~").s("sine")',
  'note(60).s("sine").filterWhen(()=>false)',
])
  test(`canary: silent boundary for ${code}; sounding revisions swap on a trigger`, async ({
    page,
  }) => {
    await page.route(
      (url) => url.protocol === 'https:',
      (route) => route.abort('internetdisconnected'),
    );
    await page.addInitScript(installEngineSignals);
    await page.goto('/harness/engine.html');
    await page.getByRole('button').click();
    await signal(() => page.evaluate(() => !!window.odm.engine)).toBe(true);
    const measurements = await page.evaluate(
      async ({ code }) => {
        const engine = window.odm.engine!;
        window.odmProfileEngine(engine);
        const events = window.odm.events;
        type Swap = Extract<EngineEvent, { type: 'swapped' | 'committed' }>;
        async function acknowledged(revision: number, type: 'swapped' | 'committed') {
          await window.odmUntil(engine, () =>
            events.some((event) => event.type === type && event.revision === revision),
          );
          return events.find(
            (event): event is Swap => event.type === type && event.revision === revision,
          )!;
        }
        const measured = [];
        const began = performance.now();
        const sounding = await engine.play('setcps(1); note(60).s("sine").fast(32)');
        const anchor = await acknowledged(sounding, 'swapped');
        const anchorMs = performance.now() - began;
        if (
          !events.some(
            (event) =>
              event.type === 'trigger' &&
              event.cycle === anchor.cycle &&
              event.time === anchor.time,
          )
        )
          throw Error('Sounding revision did not swap on its first trigger');
        const called = performance.now(),
          audioCalled = engine.audioTime();
        const revision = await engine.play(`setcps(1); ${code}`);
        const boundary = await acknowledged(revision, 'committed');
        const observedMs = performance.now() - called;
        const from = engine.audioTime();
        await engine.tap().rms(from, from + 0.3);
        measured.push({
          code,
          observedMs,
          boundaryMs: (boundary.time - audioCalled) * 1000,
          phaseError: boundary.time - (anchor.time + boundary.cycle - anchor.cycle),
          triggersAfter: events.filter(
            (event) => event.type === 'trigger' && event.time >= boundary.time,
          ).length,
          acknowledgements: events.filter(
            (event) => event.type === 'committed' && event.revision === revision,
          ).length,
        });
        const resumeCalled = performance.now();
        const resumedRevision = await engine.play('setcps(1); note(72).s("sine").fast(32)');
        const resumed = await acknowledged(resumedRevision, 'swapped');
        const resumeMs = performance.now() - resumeCalled;
        const normal = events.some(
          (event) =>
            event.type === 'trigger' &&
            event.time === resumed.time &&
            event.cycle === resumed.cycle,
        );
        engine.stop();
        return { measured, normal, anchorMs, resumeMs };
      },
      { code },
    );
    console.log('SILENT SWAP MEASURED', JSON.stringify(measurements));
    for (const row of measurements.measured) {
      expect(row.observedMs).toBeLessThan(BOUND_MS);
      expect(row.boundaryMs).toBeGreaterThanOrEqual(0);
      expect(
        Math.abs(row.phaseError),
        'Cyclist phase anchors and latency equation changed',
      ).toBeLessThan(1e-9);
      expect(row.triggersAfter).toBe(0);
      expect(row.acknowledgements).toBe(1);
    }
    expect(measurements.anchorMs).toBeLessThan(BOUND_MS);
    expect(measurements.resumeMs).toBeLessThan(BOUND_MS);
    expect(measurements.normal).toBe(true);
  });
test('Kiln: mute the only sounding instrument and clear pending', async ({ page }) => {
  await openProgram(page, { example: 'Kiln' });
  const { id, section } = await page.evaluate(() => ({
    id: window.odmApp.state.rows.find((row) => row.name === 'bass')!.id,
    section: window.odmApp.state.sections[1].name,
  }));
  await page.getByRole('button', { name: section, exact: true }).first().click();
  await selectNode(page, { nodeId: id });
  await page.getByRole('checkbox', { name: 'Solo', exact: true }).click();
  await play(page);
  const count = await page.evaluate(
    () => window.odmApp.history.filter((e) => e.type === 'committed').length,
  );
  await page.getByRole('checkbox', { name: 'Mute everywhere', exact: true }).click();
  await signal(
    () => page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'committed').length),
    { timeout: BOUND_MS },
  ).toBeGreaterThan(count);
  await waitForPending(page);
  await expect(page.locator('#editor')).not.toHaveAttribute('data-edit-state', 'pending');
  expect(await page.evaluate(() => Object.keys(window.odmApp.editor!.state.entries))).toEqual([]);
  expect(
    await page.evaluate((id) => window.odmApp.state.rows.find((row) => row.id === id)!.muted, id),
  ).toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
