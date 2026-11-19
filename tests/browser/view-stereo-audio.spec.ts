import { expect, test } from '@playwright/test';
import { appSignal } from './helpers';
import type { ViewFrame } from '../../src/views/types';
import type { EngineEvent } from '../../src/contract';
import type {} from '../../src/studio/main';

type Measurement = {
  pan: number;
  channels: number;
  complete: boolean;
  leftEnergy: number;
  rightEnergy: number;
  correlation: number | null;
  onsetOffsetMs: number;
  scoreOffsetMs: number;
  lagMs: number;
  waveError: number;
  shared: boolean;
  reused: boolean;
};
declare global {
  interface Window {
    stereoFrames: Record<string, ViewFrame>;
    stereoMeasurements: Measurement[];
    stereoObserve(frame: ViewFrame): void;
  }
}

test('Studio delivers measured left, right and centred PCM aligned with the score', async ({
  page,
  context,
}, info) => {
  await context.route('https://raw.githubusercontent.com/**', (route) =>
    route.fulfill({
      json: { _base: 'https://raw.githubusercontent.com/stereo-fixture/', bd: ['burst.wav'] },
    }),
  );
  await context.route('**/stereo-fixture/burst.wav', (route) =>
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
        window.stereoFrames = {};
        const originalMount = ${name}.mount;
        ${name}.mount = (element) => {
          const handle = originalMount(element);
          const stage = element.closest('[data-region]').dataset.region;
          return {
            frame(frame) {
              window.stereoFrames[stage] = frame;
              if (stage === 'stage-b') window.stereoObserve?.(frame);
              handle.frame(frame);
            },
            dispose() { delete window.stereoFrames[stage]; handle.dispose(); }
          };
        };
      `,
    });
  });
  await page.goto('/?inspect&a=scope&b=scope');
  await appSignal(page, () => window.odmStudio.app.canPlay && !!window.stereoFrames?.['stage-b']);
  await page.evaluate(async () => {
    await window.odmStudio.load('setcps(1); s("bd").pan("<0 1 0.5>").gain(0.5)');
    window.stereoMeasurements = [];
    let previous: ViewFrame['audio'];
    window.stereoObserve = (f) => {
      const a = f.audio;
      if (!f.playing || !a?.left || !a.right || !a.sampleRate || a.endTime === undefined) return;
      const reused =
        !previous ||
        (previous === a &&
          previous.left === a.left &&
          previous.right === a.right &&
          previous.wave === a.wave);
      previous = a;
      const triggers = window.odmStudio.app.history.filter(
        (e): e is Extract<EngineEvent, { type: 'trigger' }> => e.type === 'trigger',
      );
      const trigger = triggers.find((e) => e.cycle === window.stereoMeasurements.length);
      if (!trigger || a.endTime - trigger.time < 0.06 || a.endTime - trigger.time > 0.095) return;
      let leftEnergy = 0,
        rightEnergy = 0,
        cross = 0,
        leftSum = 0,
        rightSum = 0,
        waveError = 0;
      let first = -1;
      const n = a.wave.length;
      for (let i = 0; i < n; i++) {
        const l = a.left[i],
          r = a.right[i];
        leftEnergy += l * l;
        rightEnergy += r * r;
        cross += l * r;
        leftSum += l;
        rightSum += r;
        waveError = Math.max(waveError, Math.abs(a.wave[i] - (l + r) / 2));
        if (first < 0 && Math.max(Math.abs(l), Math.abs(r)) > 0.0001) first = i;
      }
      if (first < 0) return;
      const denominator = Math.sqrt(
        (leftEnergy - leftSum ** 2 / n) * (rightEnergy - rightSum ** 2 / n),
      );
      const onsetTime = a.endTime - (n - first) / a.sampleRate;
      const onsetCycle = f.now - ((a.lagSeconds ?? 0) + (n - first) / a.sampleRate) * f.cps;
      window.stereoMeasurements.push({
        pan: Number((trigger.value as { pan: number }).pan),
        channels: a.channels!,
        complete: a.complete!,
        leftEnergy,
        rightEnergy,
        correlation: denominator > 0 ? (cross - (leftSum * rightSum) / n) / denominator : null,
        onsetOffsetMs: (onsetTime - trigger.time) * 1000,
        scoreOffsetMs: ((onsetCycle - trigger.cycle) / f.cps) * 1000,
        lagMs: (a.lagSeconds ?? 0) * 1000,
        waveError,
        shared: a === window.stereoFrames['stage-a'].audio,
        reused,
      });
    };
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await appSignal(page, () => window.stereoMeasurements.length >= 3);
  const measured = await page.evaluate(() => window.stereoMeasurements);
  console.log('STEREO MEASURED', JSON.stringify(measured));
  await info.attach('stereo-audio-measurements', {
    body: JSON.stringify(measured, null, 2),
    contentType: 'application/json',
  });
  expect(measured.map((m) => m.pan)).toEqual([0, 1, 0.5]);
  expect(measured[0].leftEnergy).toBeGreaterThan(0.01);
  expect(measured[0].rightEnergy).toBeLessThan(measured[0].leftEnergy * 0.0001);
  expect(measured[1].rightEnergy).toBeGreaterThan(0.01);
  expect(measured[1].leftEnergy).toBeLessThan(measured[1].rightEnergy * 0.0001);
  expect(measured[2].leftEnergy / measured[2].rightEnergy).toBeCloseTo(1, 4);
  expect(measured[2].correlation).toBeCloseTo(1, 5);
  for (const m of measured) {
    expect(m.channels).toBe(2);
    expect(m.complete).toBe(true);
    expect(m.waveError).toBeLessThan(1e-7);
    expect(m.shared).toBe(true);
    expect(m.reused).toBe(true);
    expect(Math.abs(m.onsetOffsetMs)).toBeLessThan(12);
    expect(Math.abs(m.scoreOffsetMs)).toBeLessThan(12);
  }
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
