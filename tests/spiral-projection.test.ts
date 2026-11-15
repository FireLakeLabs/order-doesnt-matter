import { expect, it } from 'vitest';
import { depthProjection } from '../src/spiral/projection';
import { defaultView, laneGeometry, readView, saveView, spiralMarks } from '../src/spiral/model';

it('optional style preferences preserve old settings and safely reject invalid or denied storage', () => {
  for (const raw of ['null', '{}', 'broken', '{"keep":0,"upcoming":5}'])
    expect(readView({ getItem: () => raw })).toEqual(defaultView);
  for (const style of [undefined, 'invalid', null, 3, 'ring', 'fly-through']) {
    const raw = JSON.stringify({ keep: 2, upcoming: 4, style });
    const view = readView({ getItem: () => raw });
    expect(view).toEqual({
      keep: 2,
      upcoming: 4,
      ...(['ring', 'fly-through'].includes(String(style)) ? { style } : {}),
    });
    let saved = '';
    saveView(view, {
      setItem: (_, value) => {
        saved = value;
      },
    });
    expect(readView({ getItem: () => saved })).toEqual(view);
  }
  const denied = () => {
    throw Error('denied');
  };
  expect(readView({ getItem: denied })).toEqual(defaultView);
  expect(() =>
    saveView({ ...defaultView, style: 'fly-through' }, { setItem: denied }),
  ).not.toThrow();
});

it('projects exact tiny spans and cross-turn continuations without changing scored facts or Ring geometry', () => {
  const notes = [
    { instrument: 'a', cycle: 0, from: 0.75, to: 4.5, label: 'long' },
    { instrument: 'a', cycle: 1, from: 0.2, to: 0.20001, label: 'tiny' },
  ];
  const original = structuredClone(notes);
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 240 },
  ]) {
    const ring = spiralMarks(notes, ['a'], 1.25, size);
    const flight = spiralMarks(notes, ['a'], 1.25, size, { ...defaultView, style: 'fly-through' });
    expect(flight).toEqual(ring);
    expect(flight.filter((m) => m.onset)).toHaveLength(2);
    expect(flight.filter((m) => m.label === 'long').map((m) => [m.from, m.to])).toEqual([
      [0.75, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 4.5],
    ]);
    const projection = depthProjection(1, size, 1.25, defaultView);
    const tiny = flight.find((m) => m.label === 'tiny')!;
    expect(tiny.to - tiny.from).toBeCloseTo(0.00001, 12);
    expect(projection.point(tiny.from, tiny.radius)).not.toEqual(
      projection.point(tiny.to, tiny.endRadius),
    );
    for (const mark of flight) {
      const [x, y] = projection.point(mark.from, mark.radius);
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(Math.abs(x)).toBeLessThan(size.width / 2);
      expect(Math.abs(y)).toBeLessThan(size.height / 2);
    }
  }
  expect(notes).toEqual(original);
});

it('keeps the 128 onset boundary and recedes by real time, with static coarse-turn projection', () => {
  const size = { width: 390, height: 240 };
  for (const count of [128, 129, 512]) {
    const notes = Array.from({ length: count }, (_, n) => ({
      instrument: 'a',
      cycle: 0,
      from: n / count,
      to: (n + 1) / count,
      label: 'note',
    }));
    const marks = spiralMarks(notes, ['a'], 0, size, { ...defaultView, style: 'fly-through' });
    expect(marks).toHaveLength(count === 128 ? 128 : 64);
    expect(marks.every((m) => m.dense)).toBe(count > 128);
  }
  const g = laneGeometry(14, size);
  const radius = (time: number, camera: number) =>
    g.core + g.pitch * (time - camera + defaultView.keep + 1) + g.spacing;
  const point = (now: number, reduced: boolean) => {
    const camera = reduced ? Math.floor(now) : now;
    return depthProjection(14, size, camera, defaultView).point(1.3, radius(1.3, camera));
  };
  expect(point(1.1, true)).toEqual(point(1.9, true));
  expect(point(1.1, false)).not.toEqual(point(1.9, false));
  const projection = depthProjection(14, size, 1, defaultView);
  expect(projection.scale(3)).toBeLessThan(projection.scale(2));
  expect(projection.width(2)).toBeGreaterThan(0);
});
