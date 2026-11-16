import { expect, test } from 'vitest';
import { createQualityGovernor } from '../../src/views/shared/quality';

test('sustained slow frames reduce resolution before removing bloom; one pause does not', () => {
  const governor = createQualityGovernor();
  governor.observe(300, 300);
  governor.observe(16, 16);
  expect(governor.quality).toEqual({ scale: 1, bloom: true });
  for (const expected of [0.75, 0.5, 0.35]) {
    for (let i = 0; i < 24; i++) governor.observe(34, 34);
    expect(governor.quality).toEqual({ scale: expected, bloom: true });
  }
  for (let i = 0; i < 24; i++) governor.observe(34, 34);
  expect(governor.quality).toEqual({ scale: 0.25, bloom: false });
  for (let i = 0; i < 100; i++) governor.observe(200, 200);
  expect(governor.quality).toEqual({ scale: 0.175, bloom: false });
});
test('headroom restores quality slowly, with a neutral band between thresholds', () => {
  const governor = createQualityGovernor();
  for (let i = 0; i < 144; i++) governor.observe(34, 34);
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
      governor.observe(60, 60);
      governor.observe(16, 16);
    }
  expect(governor.quality).toEqual({ scale: 0.175, bloom: false });
  const healthy = createQualityGovernor();
  healthy.observe(300, 300);
  for (let i = 0; i < 150; i++) healthy.observe(16, 16);
  expect(healthy.quality).toEqual({ scale: 1, bloom: true });
});
