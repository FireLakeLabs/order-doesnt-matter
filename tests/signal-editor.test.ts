import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { checkDoc, instruments, walk, type Doc, type Setting } from '../src/document';
import { describeTarget } from '../src/document/edit';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { queryEventsNode } from '../src/strudel/evaluate-node';
import { signalState, signalShapes } from '../src/document/edits/signal-shared';
import { setSignalShape } from '../src/document/edits/signal-shape';
import { setSignalRange } from '../src/document/edits/signal-range';
import { setSignalPeriod } from '../src/document/edits/signal-period';
import { constantToSignal } from '../src/document/edits/signal-from-constant';
import { signalToConstant } from '../src/document/edits/signal-to-constant';
const load = (s: string) => importStrudel(s).doc;
const settings = (d: Doc) => {
  const result: Setting[] = [];
  walk(d, (n) => {
    if ('value' in n && 'name' in n) result.push(n as Setting);
  });
  return result;
};
const doc = (d: ReturnType<typeof setSignalShape>): Doc => {
  if ('ok' in d) throw Error(d.reason);
  expect(checkDoc(d)).toEqual([]);
  return d;
};
const state = (d: Doc, id: string) => {
  const s = signalState(d, id);
  if ('ok' in s) throw Error(s.reason);
  return s;
};
it('changes shape, bounds and period immutably, retaining unknown layers and their order', () => {
  const a = load(
    'const hats=s("hh*16").gain(perlin.range(.1,.35).segment(8).add(.01).fast(2)); s("bd")',
  );
  const id = settings(a).find((s) => s.name === 'gain')!.id;
  const original = structuredClone(a),
    p = state(a, id).pattern;
  const b = doc(setSignalShape(a, id, 'saw'));
  expect(a).toEqual(original);
  expect(b.body[1]).toBe(a.body[1]);
  expect(state(b, id).pattern.layers).toBe(p.layers);
  const c = doc(setSignalRange(b, id, 0.1, 0.6));
  expect(state(c, id)).toMatchObject({ low: 0.1, high: 0.6, period: 0.5 });
  expect(state(c, id).pattern.layers[1]).toBe(p.layers[1]);
  expect(state(c, id).pattern.layers[2]).toBe(p.layers[2]);
  const d = doc(setSignalPeriod(c, id, 2));
  expect(state(d, id)).toMatchObject({ period: 2 });
  expect(state(d, id).pattern.layers[3]).toMatchObject({
    name: 'fast',
    args: [{ kind: 'literal', value: 0.5 }],
  });
  expect(doc(setSignalShape(b, id, 'saw'))).toBe(b);
  expect(doc(setSignalRange(c, id, 0.1, 0.6))).toBe(c);
  expect(doc(setSignalPeriod(d, id, 2))).toBe(d);
  expect(a).toEqual(original);
  expect(state(b, id).high).toBe(0.35);
  expect(state(c, id).period).toBe(0.5);
});
it('adds missing layers and keeps range versus exponential range without switching', () => {
  for (const expr of ['sine', 'sine.rangex(200,4000)', 'sine.range(200,4000)']) {
    const a = load(`s("hh").lpf(${expr})`),
      id = settings(a).find((s) => s.name === 'cutoff')!.id;
    const b = doc(setSignalRange(a, id, 300, 6000)),
      c = doc(setSignalPeriod(b, id, 4));
    expect(state(c, id)).toMatchObject({ low: 300, high: 6000, period: 4 });
    expect(state(c, id).range?.name).toBe(expr.includes('rangex') ? 'rangex' : 'range');
  }
});
it('refuses missing, wrong, reused, parameterized, ambiguous and nonnumeric targets or inputs', () => {
  const a = load('s("hh").gain(sine)'),
    id = settings(a).find((s) => s.name === 'gain')!.id;
  for (const badId of ['missing', a.body[0].id, 'not-a-setting']) {
    for (const edit of [
      () => setSignalShape(a, badId, 'saw'),
      () => setSignalRange(a, badId, 0, 1),
      () => setSignalPeriod(a, badId, 2),
      () => signalToConstant(a, badId),
    ])
      expect(edit()).toMatchObject({ ok: false });
  }
  expect(setSignalShape(a, id, 'time')).toMatchObject({ ok: false });
  for (const [low, high] of [
    [NaN, 1],
    [0, Infinity],
    [2, 1],
  ])
    expect(setSignalRange(a, id, low, high)).toMatchObject({ ok: false });
  for (const period of [0, -1, Infinity, NaN])
    expect(setSignalPeriod(a, id, period)).toMatchObject({ ok: false });
  for (const source of ['const wave=sine; s("hh").gain(wave)', 's("hh").gain(irand(3))']) {
    const d = load(source),
      target = settings(d).find((s) => s.name === 'gain')!.id;
    for (const edit of [
      () => setSignalShape(d, target, 'saw'),
      () => setSignalRange(d, target, 0, 1),
      () => setSignalPeriod(d, target, 2),
      () => signalToConstant(d, target),
    ])
      expect(edit()).toMatchObject({ ok: false });
  }
  for (const expr of [
    'sine.range(0,1).range(2,3)',
    'sine.range("0 1",2)',
    'sine.fast(2).slow(3)',
    'sine.slow("2 4")',
  ]) {
    const d = load(`s("hh").gain(${expr})`),
      target = settings(d).find((s) => s.name === 'gain')!.id;
    expect(
      expr.includes('range') ? setSignalRange(d, target, 0, 1) : setSignalPeriod(d, target, 4),
    ).toMatchObject({ ok: false });
  }
  const log = load('s("hh").lpf(sine.rangex(200,4000))');
  expect(
    setSignalRange(log, settings(log).find((s) => s.name === 'cutoff')!.id, 0, 100),
  ).toMatchObject({ ok: false });
});
it('converts numeric constants with a useful range, and signals to their midpoint', () => {
  for (const value of [-1, 0, 0.5, 2, 100]) {
    const a = load(`s("hh").gain(${value})`),
      id = settings(a).find((s) => s.name === 'gain')!.id;
    const b = doc(constantToSignal(a, id)),
      s = state(b, id);
    expect(s.pattern.core).toMatchObject({ kind: 'signal', shape: 'sine' });
    expect(s.period).toBe(4);
    expect(s.low).toBeLessThan(s.high!);
    expect(s.low).toBeLessThanOrEqual(value);
    expect(s.high).toBeGreaterThanOrEqual(value);
    const c = doc(signalToConstant(b, id));
    expect(describeTarget(c, id).value).toBe((s.low! + s.high!) / 2);
    expect(a.body[0]).not.toBe(b.body[0]);
  }
  const a = load('s("hh").gain(true).pan("0 1")');
  for (const id of ['missing', ...settings(a).map((s) => s.id)])
    expect(constantToSignal(a, id)).toMatchObject({ ok: false });
  const huge = load('s("hh").gain(1e308)');
  expect(constantToSignal(huge, settings(huge)[0].id)).toMatchObject({ ok: false });
  const log = load('s("hh").lpf(450)'),
    logId = settings(log)[0].id;
  expect(state(doc(constantToSignal(log, logId)), logId)).toMatchObject({ low: 225, high: 900 });
  const b = load('s("hh").gain(sine.add(2))');
  expect(signalToConstant(b, settings(b).find((s) => s.name === 'gain')!.id)).toMatchObject({
    ok: false,
  });
});
const stable = (x: unknown): string =>
  Array.isArray(x)
    ? `[${x.map(stable)}]`
    : x && typeof x === 'object'
      ? `{${Object.entries(x)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}:${stable(v)}`)}}`
      : JSON.stringify(x);
it('real house worker: range → saw → two-cycle rise; every other instrument is unchanged', async () => {
  const a = load(readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'));
  const row = instruments(a).find((r) => r.name === 'percussion · hh')!;
  const id = settings(a).find(
    (s) => describeTarget(a, s.id).instrumentId === row.id && s.name === 'gain',
  )!.id;
  expect(state(a, id)).toMatchObject({ low: 0.1, high: 0.35 });
  const b = doc(setSignalRange(a, id, 0.1, 0.6));
  const c = doc(setSignalShape(b, id, 'saw')),
    d = doc(setSignalPeriod(c, id, 2));
  for (const r of instruments(a)) {
    const results = await Promise.all(
      [a, b, c, d].map((x) => queryEventsNode(generate(x, { only: r.id }), 0, 28)),
    );
    for (const result of results) expect(result.error).toBeNull();
    expect(results[0].events.length).toBeGreaterThan(0);
    if (r.id !== row.id)
      for (const result of results.slice(1))
        expect(result.events.map(stable).sort()).toEqual(results[0].events.map(stable).sort());
    else {
      const values = results[1].events.map((e) => (e.value as { gain: number }).gain);
      expect(values.length).toBeGreaterThan(0);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0.1);
      expect(Math.max(...values)).toBeLessThanOrEqual(0.6);
      expect(Math.max(...values)).toBeGreaterThan(0.35);
      const rise = results[3].events
        .filter((e) => e.part[0] < 2)
        .map((e) => (e.value as { gain: number }).gain);
      expect(rise.every((v, i) => i === 0 || v > rise[i - 1])).toBe(true);
      for (const result of results.slice(1)) {
        const omit = (e: (typeof result.events)[number]) =>
          stable({ ...e, value: { ...(e.value as object), gain: undefined } });
        expect(result.events.map(omit).sort()).toEqual(results[0].events.map(omit).sort());
      }
    }
  }
}, 20000);
it('all supported shapes and both conversions generate real worker events without changing neighbours', async () => {
  const a = load('const hats=s("hh*8").gain(.5); $: hats; s("bd*2").gain(.7)'),
    id = settings(a).find((s) => s.name === 'gain')!.id;
  const signal = doc(constantToSignal(a, id));
  const baseline = await queryEventsNode(generate(a), 0, 4);
  expect(baseline.error).toBeNull();
  for (const b of [
    ...signalShapes.map((shape) => doc(setSignalShape(signal, id, shape))),
    doc(signalToConstant(signal, id)),
  ]) {
    const result = await queryEventsNode(generate(b), 0, 4);
    expect(result.error).toBeNull();
    const others = (es: typeof result.events) =>
      es
        .filter((e) => (e.value as { s: string }).s !== 'hh')
        .map(stable)
        .sort();
    expect(others(result.events)).toEqual(others(baseline.events));
    const hats = result.events.filter((e) => (e.value as { s: string }).s === 'hh');
    expect(hats.length).toBe(32);
    expect(hats.every((e) => Number.isFinite((e.value as { gain: number }).gain))).toBe(true);
  }
}, 15000);
