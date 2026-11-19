import { expect, it } from 'vitest';
import { scoreFrame } from './score-fixture';
import { measureGlass, scoredRim, panAngle, rimMarks } from '../../src/views/stereo-glass/model';
function frame(left: number[], right: number[], channels: 1 | 2 = 2) {
  return {
    ...scoreFrame(),
    audio: {
      left: Float32Array.from(left),
      right: Float32Array.from(right),
      wave: Float32Array.from(left),
      spectrum: new Uint8Array(),
      channels,
      complete: true,
      sampleRate: 48000,
    },
  };
}
it('maps centred and mono PCM upright, anti-phase flat, and all PCM into density', () => {
  const l = [-0.8, -0.4, 0, 0.4, 0.8];
  const mid = measureGlass(frame(l, l))!;
  expect(mid.width).toBe(0);
  expect(mid.correlation).toBeCloseTo(1);
  expect(mid.bins.reduce((a, b) => a + b, 0)).toBe(l.length);
  const mono = measureGlass(
    frame(
      l,
      l.map(() => 0),
      1,
    ),
  )!;
  expect(mono.width).toBe(0);
  expect(mono.height).toBe(mid.height);
  expect(mono.mono).toBe(true);
  expect(mono.correlation).toBeNull();
  const side = measureGlass(
    frame(
      l,
      l.map((n) => -n),
    ),
  )!;
  expect(side.height).toBe(0);
  expect(side.width).toBeCloseTo(1.6);
  expect(side.correlation).toBeCloseTo(-1);
});
it('hard pans lean in opposite directions and measurement never retains previous spans', () => {
  const l = [0, 0.2, 0.4, 0.6],
    z = l.map(() => 0);
  const a = measureGlass(frame(l, z))!,
    b = measureGlass(frame(z, l))!;
  const massX = (m: typeof a) => m.bins.reduce((n, v, i) => n + v * ((i % 160) - 79.5), 0);
  expect(massX(a)).toBeLessThan(0);
  expect(massX(b)).toBeGreaterThan(0);
  expect(a.correlation).toBeNull();
  expect(measureGlass(frame(l, z))).toEqual(a);
  expect(measureGlass(frame(z, z))!.width).toBe(0);
});
it('rejects paused, missing, incomplete, zero-channel and legacy-only taps', () => {
  const f = frame([0.3], [0.2]);
  expect(measureGlass({ ...f, playing: false })).toBeUndefined();
  expect(measureGlass({ ...f, audio: undefined })).toBeUndefined();
  expect(measureGlass({ ...f, audio: { ...f.audio, complete: false } })).toBeUndefined();
  expect(measureGlass({ ...f, audio: { ...f.audio, channels: 0 } })).toBeUndefined();
  expect(
    measureGlass({ ...f, audio: { wave: f.audio.wave, spectrum: f.audio.spectrum } }),
  ).toBeUndefined();
});
it('counts coincident score notes, labels default pan and keeps lanes fixed as siblings leave', () => {
  const f = scoreFrame(20);
  f.notes = Array.from({ length: 500 }, (_, i) => ({
    instrument: String(i % 20),
    start: 10.375,
    end: 10.5,
    hasOnset: true,
    value: i % 2 ? { pan: 1 } : {},
  }));
  const ticks = scoredRim(f);
  expect(ticks).toHaveLength(20);
  expect(ticks.reduce((n, t) => n + t.count, 0)).toBe(500);
  expect(ticks.reduce((n, t) => n + t.onsets, 0)).toBe(500);
  expect(ticks[0]).toMatchObject({ pan: 0.5, source: 'default', lane: 0, count: 25 });
  expect(ticks[1]).toMatchObject({ pan: 1, source: 'written', lane: 1, count: 25 });
  expect(
    scoredRim({ ...f, notes: f.notes.filter((n) => n.instrument === '19') }).find(
      (t) => t.instrument.id === '19',
    )?.lane,
  ).toBe(19);
  expect(
    scoredRim({ ...f, notes: f.notes.map((n) => ({ ...n, hasOnset: false })) }).every(
      (t) => t.onsets === 0,
    ),
  ).toBe(true);
  expect(panAngle(0)).toBe(-Math.PI / 4);
  expect(panAngle(1)).toBe(Math.PI / 4);
});
it('shows simultaneous written pans, resting defaults, and explicit unknown settings truthfully', () => {
  const f = scoreFrame(3);
  f.instruments[1].settings = [{ name: 'pan', label: 'Pan', kind: 'constant', value: 0.2 }];
  f.instruments[2].settings = [{ name: 'pan', label: 'Pan', kind: 'signal' }];
  f.notes = [
    { instrument: '0', start: 10, end: 11, hasOnset: true, value: { pan: '0' } },
    { instrument: '0', start: 10, end: 11, hasOnset: true, value: { pan: 1 } },
  ];
  expect(scoredRim(f).map((t) => [t.pan, t.source])).toEqual([
    [0, 'written'],
    [1, 'written'],
    [0.2, 'written'],
    [0.5, 'unknown'],
  ]);
  expect(scoredRim({ ...f, notes: [] })[0]).toMatchObject({ pan: 0.5, source: 'default' });
});

it('merges 32 coincident parts into 24 lanes without losing ticks, spans or held/onset states', () => {
  const f = scoreFrame(32);
  f.notes = Array.from({ length: 64 }, (_, i) => ({
    instrument: String(i % 32),
    start: 10.375,
    end: 11,
    hasOnset: i < 32,
    value: {},
  }));
  const ticks = scoredRim(f),
    marks = rimMarks(ticks, 100);
  expect(ticks.filter((t) => t.lane === 23)).toHaveLength(9);
  expect(marks).toHaveLength(24);
  expect(marks.reduce((n, m) => n + m.ticks, 0)).toBe(32);
  expect(marks.reduce((n, m) => n + m.spans, 0)).toBe(64);
  expect(marks.reduce((n, m) => n + m.held, 0)).toBe(64);
  expect(marks.reduce((n, m) => n + m.onsets, 0)).toBe(32);
  expect(marks.filter((m) => m.ticks > 1)).toEqual([
    expect.objectContaining({ ticks: 9, spans: 18, held: 18, onsets: 9, radius: 186 }),
  ]);
  expect(marks.length + marks.reduce((n, m) => n + m.ticks - 1, 0)).toBe(ticks.length);
  // A continuation keeps its held crossbar after its onset flash expires.
  const later = rimMarks(scoredRim({ ...f, now: 10.6 }), 100);
  expect(later.reduce((n, m) => n + m.held, 0)).toBe(64);
  expect(later.every((m) => m.onsets === 0)).toBe(true);
});

it('counts off-glass points rather than claiming channel overs are clipped', () => {
  expect(measureGlass(frame([1.1], [0]))!.offGlass).toBe(0);
  const measured = measureGlass(frame([2.2], [0]))!;
  expect(measured.offGlass).toBe(1);
  expect(measured.bins.reduce((n, v) => n + v, 0)).toBe(1);
});
