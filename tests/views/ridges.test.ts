import { describe, expect, it } from 'vitest';
import { scoreFrame } from './score-fixture';
import {
  BINS,
  peakEnvelope,
  peakValue,
  profileHeight,
  ridgeClock,
  ridgePose,
  ridgeProfile,
  ridgeSection,
  ridgeSpires,
  terrainDriver,
  terrainHeight,
} from '../../src/views/ridges/model';
import type { ViewNote } from '../../src/views/types';

const note = (
  start: number,
  end: number,
  value: ViewNote['value'] = {},
  instrument = '0',
  hasOnset = true,
): ViewNote => ({ start, end, value, instrument, hasOnset });

describe('Ridges terrain selection', () => {
  it('chooses dimensionless note-to-note variation, independent of names, units and input order', () => {
    const f = scoreFrame(3);
    f.notes = [0, 1, 2, 3].flatMap((i) => [
      note(i, i + 1, { cutoff: 200 + i * 1000 }, '0'),
      note(i, i + 1, { gain: i % 2 ? 0.9 : 0.1 }, '1'),
      note(i, i + 1, { cutoff: 1000000, note: 'c3' }, '2'),
    ]);
    const driver = terrainDriver(f)!;
    expect(driver).toMatchObject({ instrument: '1', setting: 'gain', min: 0.1, max: 0.9 });
    f.instruments[1].name = 'not a bass';
    f.notes.reverse();
    expect(terrainDriver(f)).toMatchObject({ instrument: '1', setting: 'gain' });
    f.instruments[1].inSection = false;
    expect(terrainDriver(f)).toMatchObject({ instrument: '0', setting: 'cutoff' });
  });
  it('includes muted terrain for continuity, but excludes resting instruments', () => {
    const f = scoreFrame(2);
    f.notes = [note(0, 1, { pan: -1 }), note(1, 2, { pan: 1 })];
    f.instruments[0].muted = true;
    expect(terrainDriver(f)?.setting).toBe('pan');
    f.instruments[0].inSection = false;
    expect(terrainDriver(f)).toBeUndefined();
  });
  it('falls back to note, n and frequency pitch, then to a calm plain', () => {
    const f = scoreFrame();
    f.notes = [note(0, 1, { note: 'a4', n: 2 }), note(1, 2, { n: 57 }), note(2, 3, { freq: 880 })];
    expect(terrainDriver(f)).toMatchObject({ setting: 'pitch', min: 57, max: 81 });
    f.notes = [note(0, 1, { s: 'bd' })];
    expect(terrainDriver(f)).toBeUndefined();
  });
});
describe('Ridges profile', () => {
  it('keeps one setting value across each width, multiplied only by the same fixed envelope', () => {
    const f = scoreFrame();
    f.notes = [note(0, 0.4, { cutoff: 100 }), note(0.5, 1, { cutoff: 900 })];
    const driver = terrainDriver(f)!;
    for (const n of driver.samples)
      for (const phase of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        expect(
          terrainHeight(driver, n.start + phase * (n.end - n.start)) / peakEnvelope(phase),
        ).toBeCloseTo(peakValue(driver, n.value), 10);
      }
    expect(terrainHeight(driver, 0.45)).toBe(0);
    expect(terrainHeight(driver, 1.1)).toBe(0);
    const profile = ridgeProfile(driver, 0);
    expect(profile.find((p) => Math.abs(p.x - 0.2) < 1e-9)?.height).toBeCloseTo(0.14);
    expect(profileHeight(profile, 0.75)).toBeCloseTo(1);
  });
  for (const count of [8, 16])
    it(`keeps every one of ${count} adjacent notes as a peak above a shared saddle`, () => {
      const f = scoreFrame();
      f.notes = Array.from({ length: count }, (_, i) =>
        note(i / count, (i + 1) / count, { gain: i % 2 ? 0.9 : 0.1 }),
      );
      const driver = terrainDriver(f)!;
      const profile = ridgeProfile(driver, 0);
      const peaks = profile.filter(
        (p, i) =>
          i > 0 &&
          i < profile.length - 1 &&
          p.height > profile[i - 1].height &&
          p.height > profile[i + 1].height,
      );
      expect(peaks).toHaveLength(count);
      for (let i = 0; i < count; i++) {
        const peak = terrainHeight(driver, (i + 0.5) / count);
        expect(peak).toBeCloseTo(peakValue(driver, i % 2 ? 0.9 : 0.1));
        if (i > 0) {
          const saddle = terrainHeight(driver, i / count);
          expect(saddle).toBeGreaterThan(0);
          expect(saddle).toBeLessThan(peak);
          expect(terrainHeight(driver, i / count - 1e-9)).toBeCloseTo(saddle, 6);
          expect(terrainHeight(driver, i / count + 1e-9)).toBeCloseTo(saddle, 6);
        }
      }
    });
  it('uses asymmetric fixed shoulders and ground only in actual rests', () => {
    expect(peakEnvelope(0.25)).not.toBeCloseTo(peakEnvelope(0.75));
    expect(peakEnvelope(0.5)).toBe(1);
    const f = scoreFrame();
    f.notes = [note(0, 0.4, { gain: 0.2 }), note(0.6, 1, { gain: 0.8 })];
    expect(terrainHeight(terrainDriver(f), 0.5)).toBe(0);
    expect(terrainHeight(terrainDriver(f), 0.4)).toBe(0);
  });
  it('clips a long note without restarting its envelope at cycle boundaries and uses max for chords', () => {
    const f = scoreFrame();
    f.notes = [note(0.5, 2.5, { note: 60 }), note(1, 2, { note: 72 })];
    const driver = terrainDriver(f)!;
    expect(ridgeProfile(driver, 0).at(-1)?.height).toBeCloseTo(ridgeProfile(driver, 1)[0].height);
    expect(profileHeight(ridgeProfile(driver, 1), 0.5)).toBeCloseTo(1);
  });
  it('bounds sparse geometry just below the density threshold without losing short peaks', () => {
    const f = scoreFrame();
    f.notes = Array.from({ length: 127 }, (_, i) =>
      note(i / 127, (i + 1) / 127, { cutoff: i % 2 ? 400 : 800 }),
    );
    const profile = ridgeProfile(terrainDriver(f), 0);
    expect(profile.length).toBeLessThanOrEqual(BINS + 3 * f.notes.length + 2);
    f.notes = f.notes.map((n) => ({ ...n, end: n.start + 0.1 / 127 }));
    const narrow = ridgeProfile(terrainDriver(f), 0);
    expect(narrow.length).toBeLessThanOrEqual(BINS + 2 * f.notes.length + 2);
    expect(narrow.filter((p) => p.height > 0.01)).toHaveLength(127);
  });
  it('retains every dense note as occupancy, even below pixel width', () => {
    const f = scoreFrame();
    f.notes = Array.from({ length: 500 }, (_, i) =>
      note(i / 500, (i + 0.1) / 500, { cutoff: i % 2 ? 400 : 800 }),
    );
    const profile = ridgeProfile(terrainDriver(f), 0);
    expect(profile).toHaveLength(BINS + 2);
    expect(profile.slice(1, -1).reduce((sum, p) => sum + p.count, 0)).toBeGreaterThanOrEqual(500);
    expect(profile.slice(1, -1).every((p) => p.height > 0)).toBe(true);
  });
});
describe('Ridges beacons and score sizes', () => {
  it('places onsets on the profile, pitched and unpitched, never fragments; gain scales within an instrument', () => {
    const f = scoreFrame(3);
    f.notes = [
      note(0, 0.5, { cutoff: 100 }),
      note(0.5, 1, { cutoff: 900 }),
      note(0.25, 0.5, { gain: 0.2 }, '1'),
      note(0.75, 1, { gain: 0.8 }, '1'),
      note(0.2, 0.8, { note: 60 }, '2', false),
      note(0.5, 1, { note: 64 }, '2'),
    ];
    const driver = terrainDriver(f),
      profile = ridgeProfile(driver, 0);
    const spires = ridgeSpires(f, driver, 0, profile);
    expect(spires.map((s) => [s.instrument, s.x])).toEqual([
      ['1', 0.25],
      ['1', 0.75],
      ['2', 0.5],
    ]);
    expect(spires[0].base).toBeCloseTo(profileHeight(profile, 0.25));
    expect(spires[1].height).toBeGreaterThan(spires[0].height);
    f.instruments[1].inSection = false;
    expect(ridgeSpires(f, driver, 0, profile).map((s) => s.instrument)).toEqual(['2']);
  });
  for (const count of [1, 20])
    it(`represents ${count} instruments and a dense score without truncating onsets`, () => {
      const f = scoreFrame(count);
      f.notes = f.instruments.flatMap((instrument) =>
        Array.from({ length: 500 }, (_, i) => note(i / 500, (i + 1) / 500, {}, instrument.id)),
      );
      const spires = ridgeSpires(f, undefined, 0, ridgeProfile(undefined, 0));
      expect(spires.reduce((sum, s) => sum + s.count, 0)).toBe(count * 500);
      expect(spires).toHaveLength(count * BINS);
      expect(new Set(spires.map((s) => s.height)).size).toBe(1);
    });
  it('keeps empty terrain flat while the playhead and cycle clock continue', () => {
    const f = scoreFrame();
    expect(terrainDriver(f)).toBeUndefined();
    expect(ridgeProfile(undefined, 0).every((p) => p.height === 0)).toBe(true);
    expect(ridgeSpires(f, undefined, 0, ridgeProfile(undefined, 0))).toEqual([]);
    expect(ridgeClock(0.8)).toBeGreaterThan(ridgeClock(0.7));
  });
});
describe('Ridges time and section projection', () => {
  it('slides only in the final part of a cycle, continuously across its boundary', () => {
    expect(ridgeClock(10.4)).toBe(10);
    expect(ridgeClock(10.72)).toBe(10);
    expect(ridgeClock(10.86)).toBeCloseTo(10.5);
    expect(ridgePose(11, 10.999999, 6).y).toBeCloseTo(ridgePose(11, 11, 6).y, 8);
    expect(ridgePose(10, 11, 6).fade).toBeLessThan(0.1);
    expect(ridgePose(16, 10, 6).scale).toBeLessThan(ridgePose(11, 10, 6).scale);
  });
  it('computes deterministic model poses for reverse queries and negative cycles', () => {
    const times = [-0.01, 0, 10.4, 10.8, 11, 11.1, 20];
    const forward = times.map((now) => ridgePose(11, now, 6));
    const reverse = [...times]
      .reverse()
      .map((now) => ridgePose(11, now, 6))
      .reverse();
    expect(reverse).toEqual(forward);
    expect(ridgeClock(-0.001)).toBeCloseTo(0, 4);
    expect(ridgePose(11, 11.1, 6)).toEqual(ridgePose(11, 11.1, 6));
  });
  it('marks a section boundary, its name and tint identity even after arrangement wrap', () => {
    const sections = [
      { name: 'intro', from: 0, to: 8 },
      { name: 'drop', from: 8, to: 16 },
    ];
    expect(ridgeSection(sections, 8)).toMatchObject({
      index: 1,
      boundary: true,
      section: { name: 'drop' },
    });
    expect(ridgeSection(sections, 24)).toEqual(ridgeSection(sections, 8));
    expect(ridgeSection([], 8)).toEqual({ index: -1, boundary: false, section: undefined });
  });
});
