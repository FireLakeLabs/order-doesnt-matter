import { expect, test } from 'vitest';
import { Cyclist, Pattern, pure } from '@strudel/core';
import type { Hap } from './index';
import { captureTempo, loopPattern, speedPattern } from './audio-transport';
import { query, seekTo } from './index';
import { instrumentIdentity } from './instrument-identity';

test('Cyclist loop canary: shifted Haps preserve context and each boundary onset occurs exactly once', async () => {
  const sources = new WeakMap<Hap, number>();
  const tagged = new Pattern((state) =>
    pure({ s: 'sine' })
      .query(state)
      .map((hap) => Object.assign(hap, { context: { tags: ['odm:instrument:loop-canary'] } })),
  );
  const pattern = loopPattern(tagged, () => ({ from: 8, to: 10 }), sources);
  const haps = query(pattern, 8, 14).filter((hap) => hap.hasOnset());
  expect(haps.map((hap) => Number(hap.whole!.begin))).toEqual([8, 9, 10, 11, 12, 13]);
  expect(haps.map((hap) => sources.get(hap))).toEqual([8, 9, 8, 9, 8, 9]);
  expect(
    haps.map(instrumentIdentity),
    'Hap.withSpan must preserve instrument context tags',
  ).toEqual(Array(6).fill('loop-canary'));
  expect(
    query(pattern, 9.9, 10.1)
      .filter((hap) => hap.hasOnset())
      .map((hap) => Number(hap.whole!.begin)),
  ).toEqual([10]);
  let now = 0;
  let tick!: () => void;
  const triggers: { cycle: number; time: number }[] = [];
  const scheduler = new Cyclist({
    getTime: () => now,
    setInterval: (callback) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {},
    onTrigger: (hap, _d, _dur, _cps, time) => triggers.push({ cycle: sources.get(hap)!, time }),
  });
  // Initialize stopped phase, just as the audio seam does before first Play.
  scheduler.seconds_at_cps_change = 0;
  seekTo(scheduler, 8, 0);
  await scheduler.setPattern(pattern, true);
  try {
    for (let i = 1; i <= 120; i++) {
      now = i / 10;
      tick();
    }
    expect(triggers.slice(0, 6).map((t) => t.cycle)).toEqual([8, 9, 8, 9, 8, 9]);
    for (let i = 1; i < 6; i++) expect(triggers[i].time - triggers[i - 1].time).toBeCloseTo(2, 8);
    expect(haps[0].value, 'Hap.withSpan must preserve the event value').toEqual({ s: 'sine' });
  } finally {
    scheduler.stop();
  }
});

test('Cyclist speed canary: next phase anchors changed tempo without restarting or dropping starts', async () => {
  let now = 0;
  let tick!: () => void;
  const targets: number[] = [];
  const scheduler = new Cyclist({
    getTime: () => now,
    setInterval: (callback) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {},
    onTrigger: (_hap, _d, _dur, _cps, time) => targets.push(time),
  });
  await scheduler.setPattern(pure('a'), true);
  try {
    const boundary = scheduler.clock.getPhase() + scheduler.latency;
    const cycle = scheduler.lastEnd;
    scheduler.setCps(0.25);
    for (let i = 1; i <= 100; i++) {
      now = i / 10;
      tick();
    }
    expect(targets).toHaveLength(3);
    expect(targets[1]).toBeCloseTo(boundary + (1 - cycle) / 0.25, 8);
    expect(targets[2] - targets[1]).toBeCloseTo(4, 8);
  } finally {
    scheduler.stop();
  }
});

test('event tempo scales without mutating written values or dropping Hap context', () => {
  const value = { s: 'sine', cps: 0.5 };
  const hap = query(
    speedPattern(pure(value), () => 0.25),
    0,
    1,
  )[0];
  expect(hap.value).toEqual({ s: 'sine', cps: 0.125 });
  expect(value.cps).toBe(0.5);
  expect(hap.hasOnset()).toBe(true);
});

test('Cyclist tempo capture canary: authored tempo is staged while host speed changes still apply', async () => {
  const scheduler = new Cyclist({
    getTime: () => 0,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const tempo = captureTempo(scheduler);
  tempo.set(0.25);
  const written = await tempo.during(0.5, () => {
    scheduler.setCps(0.6);
    expect(scheduler.cps).toBe(0.25);
    tempo.set(0.125);
    expect(scheduler.cps).toBe(0.125);
    return Promise.resolve();
  });
  expect(written).toBe(0.6);
  scheduler.setCps(0.75);
  expect(scheduler.cps).toBe(0.75);
  await expect(tempo.during(0.5, () => Promise.reject(Error('failed evaluation')))).rejects.toThrow(
    'failed evaluation',
  );
  scheduler.setCps(1);
  expect(scheduler.cps).toBe(1);
});
