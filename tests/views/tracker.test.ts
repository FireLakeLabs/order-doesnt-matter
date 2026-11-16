import { describe, expect, it } from 'vitest';
import { analyse, channels, layout, rowY } from '../../src/views/tracker/model';
import { flash, pitch } from '../../src/views/shared/retro-2d';
import { scoreFrame } from './score-fixture';
const note = (start: number, value = {}, hasOnset = true) => ({
  instrument: '0',
  start,
  end: start + 0.1,
  value,
  hasOnset,
});
describe('tracker truth and layout', () => {
  it('preserves fractional onsets and counts every note without inventing effects', () => {
    const data = analyse([note(0, { note: 'c4' }), note(0.03), note(0.02), note(0, {}, false)]);
    expect(data.rows.get('0')?.get(0)).toMatchObject({
      count: 3,
      off: true,
      label: 'C-4',
      effect: '',
    });
    expect(analyse([note(0, {}, false)]).rows.size).toBe(0);
  });
  it('scales real per-note effects across the supplied score', () => {
    const rows = analyse([
      note(0, { lpf: 100 }),
      note(0.25, { lpf: 500 }),
      note(0.5, { lpf: 900 }),
    ]).rows.get('0');
    expect([...rows!.values()].map((v) => v.effect)).toEqual(['C00', 'C80', 'CFF']);
  });
  it('narrows then removes effects and accounts for overflow', () => {
    for (const count of [1, 20]) {
      const f = scoreFrame(count),
        l = layout(f);
      expect(l.shown + l.hidden).toBe(count);
      expect(l.cell).toBeGreaterThan(0);
    }
    expect(layout(scoreFrame(1)).effects).toBe(true);
    expect(layout({ ...scoreFrame(20), width: 560 }).hidden).toBeGreaterThan(0);
  });
  it('draws every dense onset as counted occupancy and handles an empty score', () => {
    const notes = Array.from({ length: 500 }, (_, i) => note(i / 500));
    expect([...analyse(notes).rows.get('0')!.values()].reduce((n, cell) => n + cell.count, 0)).toBe(
      500,
    );
    expect(analyse([]).rows.size).toBe(0);
  });
  it('scrolls continuously through a fixed gate and reverses without history', () => {
    const f = scoreFrame();
    const before = rowY(f, 166, 400, 24);
    f.now += 0.02;
    expect(rowY(f, 166, 400, 24)).toBeLessThan(before);
    f.now -= 0.02;
    expect(rowY(f, 166, 400, 24)).toBeCloseTo(before);
    expect(flash(note(10), { now: 9, cps: 1 })).toBe(0);
    expect(flash(note(10, {}, false), { now: 10, cps: 1 })).toBe(0);
    expect(flash(note(10), { now: 10, cps: 1 })).toBe(1);
  });
  it('classifies pitches by settings and precedence only', () => {
    expect(pitch({ note: 'eb1', n: 99 })).toBe(27);
    expect(pitch({ n: 48 })).toBe(48);
    expect(pitch({ freq: 440 })).toBe(69);
    expect(pitch({ s: 'piano' })).toBeUndefined();
  });
});

it('keeps active channels visible first when a narrow stage needs overflow', () => {
  const f = scoreFrame(20);
  for (const i of f.instruments) i.inSection = false;
  f.instruments[19].inSection = true;
  expect(channels(f)[0].id).toBe('19');
  expect(channels(f)).toHaveLength(20);
});

it('retains onsets before cycle zero when scrubbing backwards', () => {
  const data = analyse([note(-0.03)]);
  expect(data.rows.get('0')?.get(-1)).toMatchObject({ count: 1, off: true });
  expect(rowY({ now: -0.03 }, -1, 400, 24)).toBeCloseTo(399.52);
});

it('keeps the current row over the gate through its entire sixteenth, forwards and backwards', () => {
  const gate = 400,
    height = 24;
  for (const now of [10, 10.001, 10.03, 10.06, 10.1, 10.06, 10.03, -0.03]) {
    const y = rowY({ now }, Math.floor(now * 16), gate, height);
    expect(y - height / 2).toBeLessThanOrEqual(gate);
    expect(y + height / 2).toBeGreaterThan(gate);
  }
});
