import { expect, test } from 'vitest';
import { coilDetail, coilRange, helixPoint } from '../../src/views/coil/model';
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
