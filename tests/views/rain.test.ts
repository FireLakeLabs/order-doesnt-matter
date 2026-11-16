import { describe, expect, it } from 'vitest';
import { drawRain } from '../../src/views/rain.view';
import {
  indexNotes,
  landing,
  lanes,
  notePosition,
  pitch,
  project,
} from '../../src/views/rain/geometry';
import type { ViewFrame, ViewNote } from '../../src/views/types';
const note = (instrument = '0', start = 10, end = 11, value = {}, hasOnset = true): ViewNote => ({
  instrument,
  start,
  end,
  value,
  hasOnset,
});
const frame = (count = 6): ViewFrame => ({
  now: 10.4,
  width: 1300,
  height: 760,
  dpr: 1,
  lookAhead: 4,
  trails: 1,
  cps: 140 / 240,
  playing: true,
  from: 4,
  to: 20,
  sections: [],
  rooms: [],
  notes: Array.from({ length: count }, (_, i) => note(String(i))),
  instruments: Array.from({ length: count }, (_, i) => ({
    id: String(i),
    index: i,
    name: `part ${i}`,
    colour: '#fff',
    sounding: true,
    inSection: true,
    muted: false,
  })),
  theme: {
    name: 'arcade',
    ground: '#000',
    panel: '#111',
    line: '#222',
    text: '#fff',
    muted: '#aaa',
    accent: '#ff0',
    fontDisplay: 'sans-serif',
    fontMono: 'monospace',
    radius: 0,
    glow: true,
  },
});
describe('Rain score geometry', () => {
  it('places onsets on the 82% line and exactly lookAhead at the 12% horizon', () => {
    const f = frame();
    expect(project(f, 65, f.now).y).toBeCloseTo(760 * 0.82);
    const far = project(f, 65, f.now + 4);
    expect(far.y).toBeCloseTo(760 * 0.12);
    expect(far.scale).toBeCloseTo(0.35);
    expect(project(f, 65, 11).y).not.toBe(project({ ...f, now: 10.401 }, 65, 11).y);
  });
  it('uses row order and equal lanes, centres one, leaves rests out, and handles twenty', () => {
    const single = lanes(frame(1))[0];
    expect(single.right - single.left).toBeCloseTo(1300 / 3);
    expect((single.left + single.right) / 2).toBe(650);
    const f = frame(20);
    f.instruments.reverse();
    const road = lanes(f);
    expect(road).toHaveLength(20);
    expect(road.map((l) => l.instrument.index)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    for (const l of road) expect(l.right - l.left).toBeCloseTo(1170 / 20);
    f.notes = f.notes.slice(0, 2);
    f.instruments[0].inSection = false;
    expect(lanes(f)).toHaveLength(2);
    expect(lanes({ ...f, notes: [] })).toEqual([]);
  });
  it('reads note, n, and frequency; maps each visible pitch range without naming roles', () => {
    expect(pitch({ note: 'eb1', n: 99 })).toBe(27);
    expect(pitch({ note: 60 })).toBe(60);
    expect(pitch({ n: 3 })).toBe(3);
    expect(pitch({ freq: 440 })).toBe(69);
    expect(pitch({ s: 'bd' })).toBeUndefined();
    const f = frame(1);
    f.notes = [
      note('0', 10, 11, { note: 'c3' }),
      note('0', 11, 12, { note: 'c4' }),
      note('0', 15, 16, { note: 'c8' }),
    ];
    const lane = lanes(f)[0];
    expect(notePosition(lane, lane.events[0])).toBe(0);
    expect(notePosition(lane, lane.events[1])).toBe(1);
  });
  it('includes pitched ground trails in the visible range until they fade', () => {
    const f = frame(1);
    f.notes = [note('0', 10.25, 10.3, { note: 'c3' }), note('0', 10.25, 10.3, { note: 'c4' })];
    const lane = lanes(f)[0];
    expect(notePosition(lane, lane.events[0])).toBe(0);
    expect(notePosition(lane, lane.events[1])).toBe(1);
    expect(lanes({ ...f, now: 10.51 })).toEqual([]);
  });
  it('shows six lanes and holds both bass spans at the specified drop moment', () => {
    const f = frame();
    f.notes = [
      ...Array.from({ length: 4 }, (_, i) => note(String(i), 10.5, 10.625)),
      note('4', 10, 11, { note: 'eb1' }),
      note('5', 10, 11, { note: 'eb2' }),
    ];
    const road = lanes(f);
    expect(road).toHaveLength(6);
    expect(
      road
        .filter((lane) =>
          lane.events.some(({ note }) => landing(note, f.now, f.cps, f.trails).held),
        )
        .map((lane) => lane.instrument.id),
    ).toEqual(['4', '5']);
  });
  it('draws an unpitched onset cap only before it crosses the line', () => {
    const f = frame(1);
    f.theme.glow = false;
    f.notes = [note('0', 10.5, 11)];
    const fills: number[] = [];
    const noop = () => {};
    const ctx = {
      globalAlpha: 1,
      fill(this: { globalAlpha: number }) {
        fills.push(this.globalAlpha);
      },
      fillRect: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      closePath: noop,
      stroke: noop,
      save: noop,
      restore: noop,
      clip: noop,
      fillText: noop,
      ellipse: noop,
    } as unknown as CanvasRenderingContext2D;
    drawRain(ctx, f);
    expect(fills).toContain(0.93);
    fills.length = 0;
    drawRain(ctx, { ...f, now: 10.6 });
    expect(fills).toContain(0.18);
    expect(fills).not.toContain(0.93);
  });
  it('lands only onsets, holds until the real end, and computes all trails from musical time', () => {
    const n = note();
    expect(landing(n, 9.9, 0.5, 2)).toEqual({ held: false, flare: 0, ripple: -1, streak: 0 });
    expect(landing(n, 10, 0.5, 1)).toEqual({ held: true, flare: 1, ripple: 0, streak: 0 });
    expect(landing(n, 10.03, 0.5, 0).flare).toBeCloseTo(0.5);
    expect(landing(n, 10.125, 0.5, 1).ripple).toBe(0.5);
    expect(landing(n, 10.9, 0.5, 2).held).toBe(true);
    expect(landing(n, 11, 0.5, 2).held).toBe(false);
    expect(landing({ ...n, hasOnset: false }, 10, 0.5, 2)).toEqual({
      held: false,
      flare: 0,
      ripple: -1,
      streak: 0,
    });
  });
  it('keeps a just-ended isolated hit visible for its chosen trail', () => {
    const f = frame(1);
    f.notes = [note('0', 10, 10.01)];
    f.now = 10.1;
    expect(lanes(f)).toHaveLength(1);
    expect(lanes({ ...f, trails: 0 })).toHaveLength(0);
    expect(lanes({ ...f, now: 10.3 })).toHaveLength(0);
    expect(lanes({ ...f, now: 10.3, trails: 2 })).toHaveLength(1);
  });
  it('is unchanged after jumping ahead and backwards and retains every dense event', () => {
    const f = frame(1);
    f.notes = Array.from({ length: 2000 }, (_, i) => note('0', 10 + i / 500, 10 + (i + 1) / 500));
    const groups = indexNotes(f.notes);
    const before = lanes(f, groups);
    lanes({ ...f, now: 30 }, groups);
    lanes({ ...f, now: 0 }, groups);
    expect(lanes(f, groups)).toEqual(before);
    expect(before[0].events).toHaveLength(2000);
  });
});
