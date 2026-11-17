import { beforeAll, expect, it } from 'vitest';
import { indexTubes, racks, sampleRack, tubeAt } from '../../src/views/tubes/model';
import { tubeLayout } from '../../src/views/tubes/geometry';
import type { ViewFrame, ViewNote, ViewSetting } from '../../src/views/types';
import { tubesCorpusFrame } from './tubes.fixture';
import { scoreFrame } from './score-fixture';

let real: ViewFrame;
beforeAll(async () => {
  real = await tubesCorpusFrame();
});
it('indexes the real song into per-instrument ranges and metadata-ordered settings', () => {
  const index = indexTubes(real.notes);
  const sample = racks(real, index);
  expect(sample.map((r) => r.tubes.map((t) => t.setting.name))).toEqual(
    real.instruments.map((i) => i.settings.map((s) => s.name)),
  );
  expect(index.size).toBe(real.instruments.length);
});

const note = (start: number, end: number, value: ViewNote['value'], hasOnset = true): ViewNote => ({
  instrument: '0',
  start,
  end,
  value,
  hasOnset,
});
const setting: ViewSetting = { name: 'lpf', label: 'Cutoff', kind: 'signal' };
const at = (notes: ViewNote[], now: number, s = setting) => {
  const part = indexTubes(notes).get('0');
  return tubeAt(part, s, sampleRack(part, now));
};
it('reads the hpq alias from Strudel’s sampled hresonance field', () => {
  const tube = at([note(0, 1, { hresonance: 2 })], 0.5, {
    name: 'hpq',
    label: 'High-pass resonance',
    kind: 'constant',
  });
  expect(tube.text).toBe('2');
  expect(tube.range?.min).toBe(2);
  expect(tube.level).toBe(0.5);
});
it('uses sampled song ranges, excluding numerical phase noise: the real wobble cutoff is flat at 1370', () => {
  const index = indexTubes(real.notes);
  const bass = racks(real, index).find((r) => r.instrument.name === 'wobbleBass')!;
  const cutoff = bass.tubes.find((t) => t.setting.name === 'lpf')!;
  expect(index.get(bass.instrument.id)!.onsets).toHaveLength(20);
  expect(cutoff.range!.min).toBeCloseTo(1370, 8);
  expect(cutoff.range!.max).toBeCloseTo(1370, 8);
  expect(cutoff.level).toBe(0.5);
  expect(cutoff.moving).toBe(false);
  expect(cutoff.setting.kind).toBe('signal');
  for (const now of [10.2, 10.7]) {
    const held = racks({ ...real, now }, index).find(
      (r) => r.instrument.id === bass.instrument.id,
    )!;
    expect(held.tubes.find((t) => t.setting.name === 'lpf')!.level).toBe(cutoff.level);
  }
  const hats = racks(real, index).find((r) => r.instrument.name === 'hh · drop')!;
  const gain = hats.tubes.find((t) => t.setting.name === 'gain')!;
  expect(gain.moving).toBe(true);
  expect(gain.range!.min).toBe(0.35);
  expect(gain.range!.max).toBeCloseTo(0.6378581359982491);
  expect(gain.level).toBeCloseTo((0.5765772915618641 - 0.35) / (0.6378581359982491 - 0.35));
});
it('jumps exactly on each onset, holds the level, and retains it through a rest in any seek order', () => {
  const notes = [note(1, 2, { cutoff: 400 }), note(3, 4, { cutoff: 1200 })];
  expect(at(notes, 0).level).toBeUndefined();
  expect(at(notes, 1).level).toBe(0);
  expect(at(notes, 1.8).level).toBe(0);
  expect(at(notes, 2.8).level).toBe(0);
  expect(at(notes, 3).level).toBe(1);
  expect(at(notes, 4.8).level).toBe(1);
  expect(at(notes, 1.8).level).toBe(0);
  const part = indexTubes(notes).get('0');
  expect(sampleRack(part, 2.8).active).toEqual([]);
  expect(sampleRack(part, 2.8).retained[0].value.cutoff).toBe(400);
});
it('keeps older still-held notes when a newer short note has ended and reports polyphony as a band', () => {
  const notes = [note(0, 10, { cutoff: 400 }), note(1, 2, { cutoff: 1200 }), note(1, 2, {})];
  const overlap = at(notes, 1.5);
  expect(overlap.count).toBe(3);
  expect(overlap.missing).toBe(1);
  expect(overlap.low).toBe(0);
  expect(overlap.level).toBe(1);
  expect(at(notes, 3).text).toBe('400');
  const chord = [note(1, 2, { cutoff: 400 }), note(1, 2, { cutoff: 1200 })];
  const held = at(chord, 3);
  expect(held.count).toBe(2);
  expect(held.low).toBe(0);
  expect(held.level).toBe(1);
});
it('never substitutes a stale setting when a current note leaves it unset', () => {
  const notes = [note(0, 1, { cutoff: 400 }), note(2, 3, {})];
  expect(at(notes, 2.5).level).toBeUndefined();
  expect(at(notes, 2.5).missing).toBe(1);
  expect(at(notes, 4).level).toBeUndefined();
});
it('keeps the last sixteen onsets, removes matching continuations, and counts all 500 coincident notes', () => {
  const onset = note(0, 1, { cutoff: 400 });
  const part = indexTubes([onset, { ...onset, hasOnset: false }]).get('0')!;
  expect(part.notes).toHaveLength(1);
  expect(sampleRack(part, 0.5).history).toHaveLength(1);
  const notes = Array.from({ length: 500 }, (_, i) => note(0, 1, { cutoff: i }));
  const dense = at(notes, 0.5);
  expect(dense.count).toBe(500);
  expect(dense.ticks).toHaveLength(16);
  expect(dense.ticks[0]).toBeCloseTo(484 / 499);
  expect(dense.low).toBe(0);
  expect(dense.level).toBe(1);
});
it('normalizes note-name ranges with the shared pitch reader and preserves unfamiliar categorical controls', () => {
  const notes = [
    note(0, 1, { note: 'c3', custom: 'dry' }),
    note(1, 2, { note: 'c4', custom: 'wet' }),
  ];
  const pitch = at(notes, 1.5, { name: 'note', label: 'Notes', kind: 'values' });
  expect(pitch.range!.min).toBe(48);
  expect(pitch.range!.max).toBe(60);
  expect(pitch.text).toBe('c4');
  expect(pitch.level).toBe(1);
  const categorical = at(notes, 1.5, { name: 'custom', label: 'Custom', kind: 'values' });
  expect(categorical.moving).toBe(true);
  expect(categorical.text).toBe('wet');
  expect(categorical.level).toBe(1);
});
it('identical structured values remain flat, and distinct structured values remain distinct', () => {
  const s: ViewSetting = { name: 'custom', label: 'Custom', kind: 'other' };
  expect(at([note(0, 1, { custom: [1, 2] }), note(1, 2, { custom: [1, 2] })], 1.5, s).moving).toBe(
    false,
  );
  const mixed = at([note(0, 1, { custom: [1, 2] }), note(1, 2, { custom: '[1,2]' })], 1.5, s);
  expect(mixed.moving).toBe(true);
  expect(mixed.level).toBe(1);
});
it('keeps every real setting in metadata order as a tube or constant chip at both stages and desktops', () => {
  const indexed = indexTubes(real.notes);
  const current = racks(real, indexed);
  for (const [width, height] of [
    [1299, 675],
    [1131, 470],
    [559, 675],
  ]) {
    const layout = tubeLayout({ width, height }, current);
    const visible = [...layout.tubes, ...layout.chips.filter((c) => c.tube)];
    expect(visible.length).toBe(current.reduce((n, r) => n + r.tubes.length, 0));
    for (const rack of current) {
      const tubeOrder = layout.tubes.filter((t) => t.rack === rack).map((t) => t.tube.setting.name);
      expect(tubeOrder).toEqual(
        rack.tubes
          .filter((t) => !(layout.folded && t.setting.kind !== 'signal' && t.range && !t.moving))
          .map((t) => t.setting.name),
      );
    }
    const cutoff = layout.tubes.find(
      (t) => t.rack.instrument.name === 'wobbleBass' && t.tube.setting.name === 'lpf',
    )!;
    expect(cutoff).toBeDefined();
    expect(cutoff.bottom - cutoff.top).toBeGreaterThan(250);
    for (const tube of layout.tubes) {
      expect(tube.x - tube.width / 2).toBeGreaterThanOrEqual(0);
      expect(tube.x + tube.width / 2).toBeLessThanOrEqual(layout.stageWidth);
      expect(tube.top).toBeGreaterThan(80);
      expect(tube.bottom).toBeLessThan(height - 30);
    }
    for (const chip of layout.chips) {
      expect(chip.y).toBeGreaterThan(0);
      expect(chip.y + 17).toBeLessThanOrEqual(height);
    }
  }
});
it('fits one and twenty instruments and does not fold moving settings away', () => {
  for (const count of [1, 20]) {
    const f = scoreFrame(count);
    f.instruments.forEach((i) => {
      i.settings = [setting, { name: 'gain', label: 'Gain', kind: 'constant' }];
    });
    f.notes = f.instruments.flatMap((i) => [
      { ...note(0, 1, { cutoff: 400, gain: 1 }), instrument: i.id },
      { ...note(1, 2, { cutoff: 1200, gain: 1 }), instrument: i.id },
    ]);
    const current = racks(f, indexTubes(f.notes));
    const layout = tubeLayout({ width: 559, height: 675 }, current);
    expect(layout.tubes.filter((t) => t.tube.setting.name === 'lpf')).toHaveLength(count);
    expect(layout.tubes.length + layout.chips.filter((c) => c.tube).length).toBe(count * 2);
    expect(layout.tubes.every((t) => t.bottom > t.top && t.bottom < 675)).toBe(true);
  }
});
it('keeps rack geometry fixed when another setting receives its first sample', () => {
  const indexed = indexTubes(real.notes);
  const atTime = (now: number) =>
    tubeLayout({ width: 559, height: 675 }, racks({ ...real, now }, indexed));
  const before = atTime(0),
    after = atTime(18.4);
  const geometry = (layout: ReturnType<typeof tubeLayout>) => ({
    tubes: layout.tubes.map((t) => [
      t.rack.instrument.id,
      t.tube.setting.name,
      t.x,
      t.width,
      t.top,
      t.bottom,
    ]),
    chips: layout.chips.map((c) => [c.x, c.y, c.width]),
  });
  expect(geometry(after)).toEqual(geometry(before));
  expect(geometry(atTime(0))).toEqual(geometry(before));
});
it('wraps twenty racks with several moving controls without overlapping rows or dropping controls', () => {
  const f = scoreFrame(20);
  f.instruments.forEach((i) => {
    i.settings = [
      setting,
      { name: 'gain', label: 'Gain', kind: 'signal' },
      { name: 'pan', label: 'Pan', kind: 'signal' },
    ];
  });
  f.notes = f.instruments.flatMap((i) => [
    { ...note(0, 1, { cutoff: 400, gain: 0.25, pan: 0.1 }), instrument: i.id },
    { ...note(1, 2, { cutoff: 1200, gain: 0.75, pan: 0.9 }), instrument: i.id },
  ]);
  const layout = tubeLayout({ width: 559, height: 675 }, racks(f, indexTubes(f.notes)));
  expect(layout.tubes).toHaveLength(60);
  expect(layout.rows).toBeGreaterThan(2);
  expect(layout.tubes.every((t) => t.bottom - t.top > 30 && t.bottom + 26 < 675)).toBe(true);
  const bottoms = [...new Set(layout.tubes.map((t) => t.bottom))];
  const tops = [...new Set(layout.tubes.map((t) => t.top))];
  for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(bottoms[i - 1] + 26);
});
