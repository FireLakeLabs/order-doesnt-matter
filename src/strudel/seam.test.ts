import { expect, test } from 'vitest';
import { Cyclist, Pattern, pure } from '@strudel/core';
import {
  installStandIns,
  restoreStandIns,
  outputMethods,
  query,
  transpile,
  MINI_OFF,
  playheadCycle,
  seekTo,
  plainEvent,
} from './index';

test('Strudel direct query propagates errors; queryArc still swallows them', () => {
  const broken = new Pattern(() => {
    throw Error('query exploded');
  });
  expect(() => query(broken, 0, 1), 'Strudel Pattern.query must propagate query errors').toThrow(
    'query exploded',
  );
  expect(broken.queryArc(0, 1), 'Strudel queryArc swallowing behaviour changed').toEqual([]);
  expect(query(pure('a'), 0.25, 0.75).map(plainEvent)).toEqual([
    { whole: [0, 1], part: [0.25, 0.75], value: 'a', hasOnset: false },
  ]);
});

test('Strudel-owned prototype methods match the pinned surface', () => {
  expect(
    ['p', ...outputMethods].filter((name) => Object.hasOwn(Pattern.prototype, name)),
    'Strudel prototype stand-in ownership changed',
  ).toMatchInlineSnapshot(`
    [
      "out",
      "analyze",
    ]
  `);
});

test('stand-ins label, mute, number anonymous names, and restore exact descriptors', () => {
  const before = Object.getOwnPropertyDescriptors(Pattern.prototype);
  const labels = new Map<string, Pattern>();
  const installed = installStandIns(labels);
  const p = pure('a') as Pattern & Record<string, (...args: string[]) => Pattern>;
  try {
    expect(p.p('lead')).toBe(p);
    p.p('$');
    p.p('$');
    expect([...labels.keys()]).toEqual(['lead', '$0', '$1']);
    for (const name of ['_lead', 'lead_', '_$']) expect(query(p.p(name), 0, 1)).toEqual([]);
    for (const name of outputMethods) expect(p[name]()).toBe(p);
  } finally {
    restoreStandIns(installed);
  }
  expect(Object.getOwnPropertyDescriptors(Pattern.prototype)).toEqual(before);
});

for (const [source, output] of [
  ['"a b"', "return m('a b', 0);"],
  ["'a b'", "return 'a b';"],
  ['$: "a"', "return m('a', 3).p('$');"],
  ['lead: "a"', "return m('a', 6).p('lead');"],
  ['_lead: "a"', "return m('a', 7).p('_lead');"],
])
  test(`Strudel AST rewrite canary: ${source}`, () => {
    expect(transpile(source), `Strudel transpiler output shape changed for ${source}`).toBe(output);
  });
test('Strudel mini-off comment still disables double-quoted mini notation', () => {
  expect(transpile(`${MINI_OFF}\n"a b"`), 'Strudel mini-off directive behaviour changed').toBe(
    "return 'a b';",
  );
});

test('Strudel Cyclist private fields support playhead and seek without audio', async () => {
  let now = 10;
  const triggered: number[] = [];
  const scheduler = new Cyclist({
    getTime: () => now,
    setInterval: () => 1,
    clearInterval: () => {},
    onTrigger: (_hap, _deadline, _duration, _cps, target) => triggered.push(target),
  });
  expect(() => playheadCycle(scheduler), 'Cyclist uninitialized phase must fail clearly').toThrow(
    /seconds_at_cps_change/,
  );
  await scheduler.setPattern(pure('a'), true);
  try {
    now = triggered[0];
    expect(playheadCycle(scheduler), 'Strudel Cyclist target-time equation changed').toBeCloseTo(
      0,
      12,
    );
    now += 2;
    expect(playheadCycle(scheduler)).toBeCloseTo(1, 12);
    expect(() => seekTo(scheduler, 8, now)).toThrow(/stopped/);
    scheduler.stop();
    seekTo(scheduler, 8, now);
    expect(scheduler.lastEnd).toBe(8);
    expect(playheadCycle(scheduler)).toBe(0);
    await scheduler.setPattern(pure('a'), true);
    now = triggered.at(-1)!;
    expect(
      playheadCycle(scheduler),
      'Strudel Cyclist restart must preserve the requested origin',
    ).toBeCloseTo(8, 12);
    for (const [field, bad] of Object.entries({
      lastEnd: undefined,
      num_cycles_at_cps_change: 'bad',
      seconds_at_cps_change: NaN,
      cps: null,
      getTime: 0,
      started: 1,
      latency: undefined,
    }))
      expect(
        () => playheadCycle({ ...scheduler, [field]: bad }),
        `Strudel scheduler field validation: ${field}`,
      ).toThrow(field);
  } finally {
    scheduler.stop();
  }
  expect(playheadCycle(scheduler)).toBe(0);
});
