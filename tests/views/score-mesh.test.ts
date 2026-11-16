import { expect, test } from 'vitest';
import * as THREE from 'three';
import { createScoreMesh } from '../../src/views/shared/score-mesh';
import { createQualityGovernor } from '../../src/views/shared/quality';
import { scoreFrame } from './score-fixture';

test('every LOD restores the full colour range after rendering only emission', () => {
  const governor = createQualityGovernor();
  const score = createScoreMesh(
    {
      THREE,
      get quality() {
        return governor.quality;
      },
    },
    true,
  );
  score.populate(
    [0, 10, 20].map((cycle) => ({
      cycle,
      radius: 1,
      width: 0.1,
      colour: '#ffffff',
      muted: false,
      arcs: [{ from: 0, to: 1, start: 0, end: 1, onset: true }],
    })),
  );
  const counts: number[] = [];
  for (const scale of [1, 0.75, 0.5, 0.35]) {
    expect(governor.quality.scale).toBe(scale);
    score.update(scoreFrame());
    counts.push(score.mesh.geometry.index!.count);
    score.emission(true);
    expect(score.mesh.geometry.drawRange.start).toBeGreaterThan(0);
    expect(score.mesh.geometry.drawRange.count).toBeLessThan(score.mesh.geometry.index!.count);
    score.emission(false);
    expect(score.mesh.geometry.drawRange).toEqual({ start: 0, count: Infinity });
    for (let i = 0; i < 3; i++) governor.observe(100, 250);
  }
  expect(counts[1]).toBe(counts[0]);
  expect(counts[2]).toBe(counts[0] / 2);
  expect(counts[3]).toBe(counts[0] / 4);
  score.dispose();
});
