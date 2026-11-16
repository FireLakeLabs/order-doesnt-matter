import { describe, expect, it } from 'vitest';
import {
  activeRange,
  buildCloth,
  flash,
  layout,
  occupancy,
  pitch,
  stitchLight,
  wakeLength,
} from '../../src/views/loom/geometry';
import type { ViewFrame, ViewNote } from '../../src/views/types';

const note = (start: number, end: number, value: ViewNote['value'] = {}): ViewNote => ({
  instrument: 'thread-0',
  start,
  end,
  hasOnset: true,
  value,
});
function frame(notes: ViewNote[] = [], count = 1): ViewFrame {
  return {
    now: 0,
    playing: true,
    cps: 0.5,
    notes,
    from: 0,
    to: 16,
    instruments: Array.from({ length: count }, (_, index) => ({
      id: `thread-${String(index)}`,
      name: `voice ${String(index)}`,
      index,
      colour: '#ff4d8d',
      sounding: false,
      inSection: true,
      muted: false,
      settings: [],
      rewrites: [],
      room: null,
    })),
    sections: [],
    rooms: [],
    lookAhead: 4,
    trails: 1,
    theme: {
      name: 'arcade',
      ground: '#07060d',
      panel: '#12101f',
      line: '#2a2545',
      text: '#f4f1ff',
      muted: '#a49ec4',
      accent: '#ffd23f',
      fontDisplay: 'Space Grotesk',
      fontMono: 'JetBrains Mono',
      radius: 10,
      glow: true,
    },
    width: 1300,
    height: 760,
    dpr: 1,
  };
}

describe('Loom score geometry', () => {
  it('fits every thread for one, twenty and crowded instruments, with quiet empty rows', () => {
    for (const count of [0, 1, 20, 100]) {
      const input = frame([], count);
      const cloth = buildCloth(input);
      expect(cloth.threads).toHaveLength(count);
      expect(cloth.threads.every((thread) => thread.stitches.length === 0)).toBe(true);
      expect(cloth.box.top + cloth.box.height).toBeLessThan(input.height);
      expect(cloth.box.pitch).toBeLessThanOrEqual(44);
      if (count === 100) expect(cloth.box.labels).toBe(false);
    }
    expect(layout(frame([], 20)).pitch).toBeGreaterThanOrEqual(10);
  });

  it('keeps real spans, maps each instrument pitch range and normalizes its gain', () => {
    const input = frame([
      note(0.13, 0.48, { note: 'c2', gain: 0.2 }),
      note(0.6, 1.9, { note: 'c3', gain: 0.95 }),
      note(2, 3),
      note(3, 4, { gain: 0 }),
    ]);
    const {
      threads: [thread],
      box,
      scale,
    } = buildCloth(input);
    const [low, high, unpitched, silent] = thread.stitches;
    expect(low.x).toBeCloseTo(box.left + 0.13 * scale);
    expect(low.width).toBeCloseTo(0.35 * scale);
    expect(low.height).toBeCloseTo(box.pitch * 0.6);
    expect(high.y).toBeLessThan(low.y);
    expect(low.level).toBeLessThan(high.level);
    expect(high.level).toBe(1);
    expect(unpitched.level).toBe(1);
    expect(silent.level).toBe(0);
  });

  it('reads note names, numbers, n and frequency in contract order', () => {
    expect(pitch({ note: 'eb3' })).toBe(51);
    expect(pitch({ note: 'C#4' })).toBe(61);
    expect(pitch({ note: 42, n: 9, freq: 440 })).toBe(42);
    expect(pitch({ n: '60' })).toBe(60);
    expect(pitch({ freq: 440 })).toBe(69);
    expect(pitch({ note: 'x', n: 60, freq: 440 })).toBe(60);
    expect(pitch({ note: 'cs3' })).toBe(49);
    expect(pitch({ note: 'df3' })).toBe(49);
    expect(pitch({ note: 'bad', freq: 440 })).toBe(69);
    expect(pitch({ s: 'bd' })).toBeUndefined();
  });

  it('finds overlapping held notes and flashes identically when time runs backwards', () => {
    const held = note(0, 8);
    const fragment = { ...note(0.5, 1), hasOnset: false };
    const thread = buildCloth(frame([held, fragment, note(1, 1.25), note(3, 4)])).threads[0];
    const visible = (now: number) => {
      const range = activeRange(thread, now);
      return thread.stitches.slice(range.first, range.end).filter((n) => n.end > now);
    };
    const atOne = visible(1);
    visible(6);
    expect(visible(1)).toEqual(atOne);
    expect(atOne.map((n) => n.start)).toEqual([0, 1]);
    expect(visible(8)).toHaveLength(0);
    const stitch = thread.stitches[2];
    expect(flash(stitch, 1, 0.5)).toBe(1);
    expect(flash(stitch, 1.075, 0.5)).toBeCloseTo(0);
    expect(flash(thread.stitches[1], 0.5, 0.5)).toBe(0);
    expect(flash(stitch, 0.9, 0.5)).toBe(0);
  });

  it('accounts for all 500 notes per cycle, without overlap inflation or subpixel aliasing', () => {
    const input = frame(Array.from({ length: 8000 }, (_, i) => note(i / 500, (i + 0.5) / 500)));
    const thread = buildCloth(input).threads[0];
    expect(thread.stitches).toHaveLength(8000);
    const bins = thread.occupancy;
    if (!bins) throw Error('Expected dense occupancy');
    const coverage = [...bins].reduce((sum, n) => sum + n, 0);
    expect(coverage).toBeCloseTo(buildCloth(input).box.width / 2, 2);
    expect(Math.max(...bins)).toBeLessThanOrEqual(1.00001);
    const s = thread.stitches[0];
    const duplicates = occupancy([s, s], s.x, 1);
    expect(duplicates.coverage[0]).toBeCloseTo(s.width);
  });

  it('clips fragments at either edge and retains the absolute onset', () => {
    const input = frame([note(-2, 0.5), note(15.9, 18), note(16, 17), note(2, 2)]);
    const {
      threads: [thread],
      box,
    } = buildCloth(input);
    expect(thread.stitches).toHaveLength(2);
    expect(thread.stitches[0].x).toBe(box.left);
    expect(thread.stitches[0].start).toBe(-2);
    const last = thread.stitches[1];
    expect(last.x + last.width).toBeCloseTo(box.left + box.width);
  });

  it('retains the pitch contour when dense stitches become occupancy', () => {
    const input = frame(
      Array.from({ length: 8000 }, (_, i) =>
        note(i / 500, (i + 0.5) / 500, { note: i < 4000 ? 36 : 48 }),
      ),
    );
    const thread = buildCloth(input).threads[0];
    const tops = thread.tops;
    if (!tops) throw Error('Expected dense pitch contour');
    expect(tops[10]).toBeGreaterThan(tops[tops.length - 10]);
  });

  it('keeps ended hits lit for the selected wake, fading by level and reversible musical time', () => {
    const thread = buildCloth(frame([note(0, 1), { ...note(0, 1), hasOnset: false }])).threads[0];
    const stitch = thread.stitches[0];
    expect(wakeLength(0)).toBe(0);
    expect(wakeLength(1)).toBe(0.25);
    expect(wakeLength(2)).toBe(1);
    expect(stitchLight(stitch, 1.125, 0.5, wakeLength(0))).toBe(0);
    expect(stitchLight(stitch, 1.125, 0.5, wakeLength(1))).toBeCloseTo(0.06);
    const long = stitchLight(stitch, 1.3, 0.5, wakeLength(2));
    expect(long).toBeGreaterThan(0);
    expect(stitchLight(stitch, 1.3, 0.5, wakeLength(1))).toBe(0);
    expect(stitchLight(stitch, 2, 0.5, wakeLength(2))).toBe(0);
    expect(stitchLight(stitch, 1.3, 0.5, wakeLength(2))).toBe(long);
    expect(stitchLight({ ...stitch, level: 0.5 }, 1.3, 0.5, 1)).toBeLessThan(long);
    expect(stitchLight(thread.stitches[1], 1.1, 0.5, 1)).toBe(0);
    expect(activeRange(thread, 1.3, 1)).toEqual({ first: 0, end: 2 });
    expect(activeRange(thread, 1.3, 0.25)).toEqual({ first: 2, end: 2 });
  });

  it('never creates a second flash at note-off, for short or held notes at any speed', () => {
    const base = buildCloth(frame([note(0, 1)])).threads[0].stitches[0];
    for (const end of [0.01, 0.125, 1, 4]) {
      for (const cps of [0.1, 0.5, 1]) {
        for (const level of [0.2, 1]) {
          const stitch = { ...base, end, level };
          for (const trails of [1, 2] as const) {
            const before = stitchLight(stitch, end - 0.000001, cps, wakeLength(trails));
            const after = stitchLight(stitch, end + 0.000001, cps, wakeLength(trails));
            expect(after).toBeLessThanOrEqual(before);
            expect(after).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
