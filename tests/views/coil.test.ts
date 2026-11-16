import { expect, test } from 'vitest';
import * as THREE from 'three';
import { coilDetail, coilRange, helixPoint, coilPose } from '../../src/views/coil/model';
import { cycleStrips } from '../../src/views/shared/score-strips';
import { scoreFrame } from './score-fixture';

test('28 joined loops span the whole arrangement; unknown endings are explicitly open', () => {
  const f = scoreFrame();
  f.sections = [
    { name: 'intro', from: 0, to: 4 },
    { name: 'drop', from: 4, to: 28 },
  ];
  expect(coilRange(f)).toMatchObject({ from: 0, to: 28, length: 28, open: false });
  expect(coilRange({ ...f, now: 38.4 })).toMatchObject({ from: 28, to: 56 });
  expect(coilRange({ ...f, sections: [] })).toMatchObject({ from: 0, to: 16, open: true });
  const before = helixPoint(11 - 1e-6, 0, 28),
    after = helixPoint(11 + 1e-6, 0, 28);
  expect(Math.hypot(before.x - after.x, before.y - after.y, before.z - after.z)).toBeLessThan(
    0.0001,
  );
  expect(helixPoint(0, 0, 28).x).toBe(-5);
  expect(helixPoint(28, 0, 28).x).toBe(5);
  expect(helixPoint(10.25, 0, 28).z).toBeCloseTo(1);
  expect(helixPoint(10.75, 0, 28).z).toBeCloseTo(-1);
});
test('long pieces compress outside the playhead neighbourhood and reverse seeks restore detail', () => {
  expect(coilDetail(1, 10.4, 28)).toBe(true);
  expect(coilDetail(1, 10.4, 256)).toBe(false);
  expect(coilDetail(10, 10.4, 256)).toBe(true);
  expect(coilDetail(10, 20.4, 256)).toBe(false);
  expect(coilDetail(10, 10.4, 256)).toBe(true);
});
test('static strips preserve empty tracks, real spans, muted instruments and dense occupancy', () => {
  for (const count of [1, 20]) {
    const f = scoreFrame(count);
    f.instruments[0].muted = true;
    expect(cycleStrips(f, 10)).toHaveLength(count);
    f.notes = [{ instrument: '0', start: 10.137, end: 10.763, hasOnset: false, value: {} }];
    const notes = cycleStrips(f, 10).filter((s) => !s.track);
    expect(notes).toHaveLength(1);
    expect(notes[0].muted).toBe(true);
    expect(notes[0].arcs[0]).toMatchObject({
      from: expect.closeTo(0.137),
      to: expect.closeTo(0.763),
      onset: false,
    });
    const occupancy = cycleStrips(f, 10, true).filter((s) => !s.track)[0].arcs;
    expect(occupancy.length).toBeLessThanOrEqual(64);
  }
});

test('the long-lens level axis keeps loop pitch even and the complete song in view', () => {
  for (const [width, height] of [
    [1300, 760],
    [1920, 1080],
    [1131, 469],
  ]) {
    const frame = { width, height, now: 10.4 };
    const { distance, follow } = coilPose(frame, 0, 28);
    const camera = new THREE.PerspectiveCamera(1, width / height, distance * 0.5, distance * 1.5);
    camera.up.set(0, 1, -0.25);
    camera.position.set(distance * 0.18 + follow, distance * 0.25, distance);
    camera.lookAt(follow, 0, 0);
    camera.updateMatrixWorld();
    const centres = Array.from({ length: 28 }, (_, i) =>
      new THREE.Vector3((i / 28 - 0.5) * 10, 0, 0).project(camera),
    );
    const pitches = centres.slice(1).map((p, i) => p.x - centres[i].x);
    expect(Math.max(...pitches) / Math.min(...pitches)).toBeLessThan(1.02);
    expect(
      Math.max(...centres.map((p) => p.y)) - Math.min(...centres.map((p) => p.y)),
    ).toBeLessThan(1e-6);
    const points = Array.from({ length: 28 * 64 + 1 }, (_, i) => {
      const p = helixPoint(i / 64, 0, 28, 1.2);
      return new THREE.Vector3(p.x, p.y, p.z).project(camera).x;
    });
    const span = (Math.max(...points) - Math.min(...points)) / 2;
    expect(span).toBeGreaterThan(0.87);
    expect(span).toBeLessThan(0.94);
  }
});
test('500 onsets degrade to occupancy while empty and twenty-voice scores retain every band', () => {
  for (const count of [1, 20]) {
    const frame = scoreFrame(count);
    expect(cycleStrips(frame, 10).filter((strip) => strip.track)).toHaveLength(count);
    frame.notes = Array.from({ length: 500 }, (_, i) => ({
      instrument: '0',
      start: 10 + i / 500,
      end: 10 + (i + 0.5) / 500,
      hasOnset: true,
      value: {},
    }));
    const occupied = cycleStrips(frame, 10).filter((strip) => !strip.track);
    expect(occupied).toHaveLength(1);
    expect(occupied[0].arcs.length).toBeLessThanOrEqual(64);
    expect(occupied[0].arcs.length).toBeGreaterThan(0);
    expect(cycleStrips(frame, 10).filter((strip) => strip.track)).toHaveLength(count);
  }
});
