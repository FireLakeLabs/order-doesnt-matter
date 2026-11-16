import { expect, test } from 'vitest';
import { createQualityGovernor, createFrameObserver } from '../../src/views/shared/quality';

test('sustained slow frames reduce resolution before removing bloom; one pause does not', () => {
  const governor = createQualityGovernor();
  governor.observe(300, 300);
  governor.observe(16, 16);
  expect(governor.quality).toEqual({ scale: 1, bloom: true });
  for (const expected of [0.75, 0.5, 0.35]) {
    for (let i = 0; i < 24; i++) governor.observe(37, 37);
    expect(governor.quality).toEqual({ scale: expected, bloom: true });
  }
  for (let i = 0; i < 24; i++) governor.observe(37, 37);
  expect(governor.quality).toEqual({ scale: 0.25, bloom: false });
  for (let i = 0; i < 100; i++) governor.observe(200, 200);
  expect(governor.quality).toEqual({ scale: 0.175, bloom: false });
});
test('headroom restores quality slowly, with a neutral band between thresholds', () => {
  const governor = createQualityGovernor();
  for (let i = 0; i < 144; i++) governor.observe(37, 37);
  for (let i = 0; i < 249; i++) governor.observe(16, 16);
  expect(governor.quality.bloom).toBe(false);
  governor.observe(16, 16);
  expect(governor.quality).toEqual({ scale: 0.25, bloom: false });
  for (let i = 0; i < 500; i++) governor.observe(27, 27);
  expect(governor.quality).toEqual({ scale: 0.25, bloom: false });
  for (const quality of [
    { scale: 0.35, bloom: true },
    { scale: 0.5, bloom: true },
    { scale: 0.75, bloom: true },
    { scale: 1, bloom: true },
  ]) {
    for (let i = 0; i < 250; i++) governor.observe(16, 16);
    expect(governor.quality).toEqual(quality);
  }
});
test('fast frames between GPU stalls do not hide a sustained over-budget average', () => {
  const governor = createQualityGovernor();
  for (let level = 0; level < 5; level++)
    for (let i = 0; i < 11; i++) {
      governor.observe(70, 70);
      governor.observe(16, 16);
    }
  expect(governor.quality).toEqual({ scale: 0.175, bloom: false });
  const healthy = createQualityGovernor();
  healthy.observe(300, 300);
  for (let i = 0; i < 150; i++) healthy.observe(16, 16);
  expect(healthy.quality).toEqual({ scale: 1, bloom: true });
});

test('a healthy 30 Hz cap does not reduce quality', () => {
  const governor = createQualityGovernor();
  for (let i = 0; i < 1000; i++) governor.observe(1000 / 30, 1000 / 30);
  expect(governor.quality).toEqual({ scale: 1, bloom: true });
});
test('an immediately failed recovery backs off before probing again', () => {
  const governor = createQualityGovernor();
  for (let i = 0; i < 15; i++) governor.observe(100, 250);
  for (let i = 0; i < 250; i++) governor.observe(16, 16);
  expect(governor.quality).toEqual({ scale: 0.25, bloom: false });
  for (let i = 0; i < 3; i++) governor.observe(100, 250);
  for (let i = 0; i < 499; i++) governor.observe(16, 16);
  expect(governor.quality).toEqual({ scale: 0.175, bloom: false });
  governor.observe(16, 16);
  expect(governor.quality).toEqual({ scale: 0.25, bloom: false });
});
test('pause and resume gaps do not masquerade as GPU backpressure', () => {
  const governor = createQualityGovernor();
  const observe = createFrameObserver(governor);
  for (let i = 0; i < 30; i++) {
    observe(1 + i * 20000, 1, true);
    observe(17 + i * 20000, 1, false);
  }
  expect(governor.quality.scale).toBe(1);
  for (let i = 0; i < 20; i++) observe(600001 + i * 100, 1, true);
  expect(governor.quality.scale).toBeLessThan(1);
  const nextStage = createFrameObserver(governor);
  const learned = governor.quality;
  nextStage(1, 1, true);
  expect(governor.quality).toBe(learned);
});
