import { expect, test } from 'vitest';
import * as THREE from 'three';
import {
  coilDetail,
  coilRange,
  helixPoint,
  coilPose,
  clampPitch,
} from '../../src/views/coil/model';
import { noteDescription, barNotes, barRows } from '../../src/views/coil/inspect';
import { pickSurfaces, pickSurface } from '../../src/views/coil/picking';
import { coilFrame, coilNotes } from '../../src/views/coil/score';
import { cycleStrips } from '../../src/views/shared/score-strips';
import { scoreFrame } from './score-fixture';

test('one onset and its identical continuations feed one strip, hit target and flat lane', () => {
  const frame = scoreFrame();
  const onset = {
    instrument: '0',
    start: 10,
    end: 11,
    hasOnset: true,
    value: { note: 'eb2', cutoff: 1370 },
  };
  const continuation = { ...onset, hasOnset: false, value: { cutoff: 1370, note: 'eb2' } };
  frame.notes = [continuation, onset, continuation];
  const scored = coilFrame(frame);
  expect(scored.notes).toEqual([onset]);
  expect(frame.notes).toHaveLength(3);
  expect(coilFrame(frame).notes).toBe(scored.notes);
  expect(coilFrame(scored)).toBe(scored);
  expect(
    cycleStrips(scored, 10)
      .filter((s) => !s.track)
      .flatMap((s) => s.arcs),
  ).toHaveLength(1);
  expect(pickSurfaces(frame, 0, 28).filter((s) => s.note)).toHaveLength(1);
  expect(barRows(frame, 10)[0].lanes).toEqual([0]);
});

test('genuine chord/unison onsets and unmatched or changed continuations survive', () => {
  const frame = scoreFrame();
  const chord = ['c3', 'g3', 'eb4'].map((note) => ({
    instrument: '0',
    start: 10,
    end: 11,
    hasOnset: true,
    value: { note },
  }));
  frame.notes = chord.flatMap((n) => [n, { ...n, hasOnset: false }]);
  expect(barRows(frame, 10)[0].lanes).toEqual([0, 1, 2]);
  expect(coilNotes([chord[0], chord[0]])).toHaveLength(2);
  const held = { ...chord[0], hasOnset: false };
  const changed = { ...held, value: { note: 'c3', gain: 0.5 } };
  expect(coilNotes([held, changed])).toEqual([held, changed]);
  expect(coilNotes([chord[0], changed])).toEqual([chord[0], changed]);
});

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

test('perspective keeps the whole song framed at desktop sizes, with visible depth', () => {
  for (const [width, height] of [
    [960, 600],
    [1300, 760],
    [1920, 1080],
  ]) {
    const { distance } = coilPose({ width, height });
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.02, distance * 8);
    camera.position
      .set(Math.sin(0.65) * Math.cos(0.22), Math.sin(0.22), Math.cos(0.65) * Math.cos(0.22))
      .multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (let i = 0; i <= 28 * 64; i++) {
      const p = helixPoint(i / 64, 0, 28, 1.2);
      const projected = new THREE.Vector3(p.x, p.y, p.z).project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(1);
      expect(Math.abs(projected.y)).toBeLessThan(0.8);
    }
    const near = new THREE.Vector3(1, 0, 1).project(camera),
      far = new THREE.Vector3(1, 0, -1).project(camera);
    expect(Math.abs(near.x - far.x)).toBeGreaterThan(0.005);
  }
  expect(clampPitch(10)).toBeCloseTo((85 * Math.PI) / 180);
  expect(clampPitch(-10)).toBeCloseTo((-85 * Math.PI) / 180);
});
test('note inspection preserves pitch, settings, exact timing and overlapping bar fragments', () => {
  const frame = scoreFrame();
  frame.instruments[0].name = 'wobbleBass';
  const note = {
    instrument: '0',
    start: 10.25,
    end: 11.5,
    hasOnset: true,
    value: { note: 'eb2', s: 'sawtooth', lpf: 1370 },
  };
  frame.notes = [note];
  expect(noteDescription(note, frame)).toContain('wobbleBass · E♭2');
  expect(noteDescription(note, frame)).toContain('Position 11.2 · length 5 beats');
  expect(noteDescription(note, frame)).toContain('lpf: 1370');
  for (const offset of [28, 28.5]) {
    const looped = {
      ...frame,
      now: 10.4 + offset,
      sections: [{ name: 'song', from: 0, to: offset }],
    };
    expect(
      noteDescription({ ...note, start: note.start + offset, end: note.end + offset }, looped),
    ).toContain('Position 11.2 · length 5 beats');
  }
  expect(barNotes(frame, 11)).toEqual([note]);
  expect(barNotes(frame, 12)).toEqual([]);
  frame.notes = [note, { ...note, value: { note: 'g2' } }, { ...note, value: { note: 'bb2' } }];
  const rows = barRows(frame, 10);
  expect(rows).toHaveLength(1);
  expect(rows[0].lanes).toEqual([0, 1, 2]);
  expect(rows[0].laneHeight).toBeGreaterThanOrEqual(18);
});
test('unsectioned windows retain absolute bar positions', () => {
  const frame = { ...scoreFrame(), now: 35.4 };
  const note = {
    instrument: '0',
    start: 35.25,
    end: 35.75,
    hasOnset: true,
    value: { note: 'eb2' },
  };
  expect(coilRange(frame)).toMatchObject({ from: 32, open: true });
  expect(noteDescription(note, frame)).toContain('Position 36.2 · length 2 beats');
});
test('picking the deformed ribbon returns the original note and turn, including a reverse seek', () => {
  const frame = scoreFrame();
  const note = { instrument: '0', start: 10.2, end: 10.4, hasOnset: true, value: { note: 'eb2' } };
  frame.notes = [note];
  const surfaces = pickSurfaces(frame, 0, 28);
  const surface = surfaces.find((s) => s.note === note)!;
  for (const now of [10.3, 20.4, 10.3]) {
    const vertices = surface.points.slice(8, 11).map((p) => {
      const t = (p.time - now) / 0.7,
        scale = 1 + (Math.abs(t) < 2 ? Math.exp(-t * t * t * t) * 0.16 : 0);
      return new THREE.Vector3(p.x, p.y * scale, p.z * scale + surface.depth);
    });
    const target = vertices
      .reduce((sum, v) => sum.add(v), new THREE.Vector3())
      .multiplyScalar(1 / 3);
    const normal = vertices[1]
      .clone()
      .sub(vertices[0])
      .cross(vertices[2].clone().sub(vertices[0]))
      .normalize();
    const ray = new THREE.Ray(target.clone().addScaledVector(normal, 10), normal.negate());
    expect(pickSurface(THREE, ray, [surface], now)?.note).toBe(note);
    expect(pickSurface(THREE, ray, [surface], now)?.cycle).toBe(10);
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
