import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { parseSteps, printSteps } from '../src/import/mini';
import { queryEvents, queryEventsWithBudget } from '../src/strudel/evaluate';
import { queryEventsNode } from '../src/strudel/evaluate-node';
import { checkDoc, voices, instruments } from '../src/document';
import type { Doc } from '../src/document';
import baseline from './corpus/tier3-baseline.json';
import { tierTotals } from './corpus/metrics';
import { controlNames } from '../src/import/registry';
import { build } from 'vite';

const index: { id: string; file: string; cycles: number }[] = JSON.parse(
  readFileSync(new URL('../corpus/index.json', import.meta.url), 'utf8'),
);
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => k !== 'id' && k !== 'span')
      .map(([k, v]) => [k, clean(v)]),
  );
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
    .join(',')}}`;
}
const events = (items: unknown[]) => items.map(stable).sort();
const tier3 = (doc: Doc) => tierTotals(doc)[3];
async function equivalent(source: string, horizon = 2) {
  const { doc } = importStrudel(source);
  const fresh = generate(doc);
  expect(checkDoc(doc)).toEqual([]);
  expect(clean(importStrudel(fresh).doc), fresh).toEqual(clean(doc));
  const a = await queryEvents(source, 0, horizon);
  const b = await queryEvents(fresh, 0, horizon);
  expect(b, fresh).toEqual(a);
  expect(a.error).toBeNull();
  return { doc, fresh, result: a };
}

describe('corpus proof', () => {
  it('baseline covers exactly the indexed corpus', () =>
    expect(Object.keys(baseline).sort()).toEqual(index.map((p) => p.id).sort()));
  for (const entry of index)
    it(entry.id, async () => {
      const source = readFileSync(new URL(`../corpus/${entry.file}`, import.meta.url), 'utf8');
      const { doc } = importStrudel(source);
      expect(checkDoc(doc)).toEqual([]);
      expect(importStrudel(source).doc).toEqual(doc);
      expect(tier3(doc)).toBeLessThanOrEqual(baseline[entry.id as keyof typeof baseline]);
      const fresh = generate(doc);
      expect(clean(importStrudel(fresh).doc)).toEqual(clean(doc));
      const end = Math.max(entry.cycles + 1, entry.id.startsWith('real-') ? 17 : 16);
      const [original, regenerated] = await Promise.all([
        queryEventsNode(source, 0, end),
        queryEventsNode(fresh, 0, end),
      ]);
      expect(regenerated).toEqual(original);
      if (entry.id === 'micro-query-throws') {
        expect(original.error).toMatchObject({
          phase: 'query',
          message: 'corpus intentional query failure',
        });
        expect(original.events).toEqual([]);
      } else if (entry.id === 'micro-query-late-throws') {
        expect(original.error).toMatchObject({
          phase: 'query',
          message: 'corpus intentional late failure',
        });
        expect(original.events).toHaveLength(3);
      } else {
        expect(original.error).toBeNull();
        expect(original.opaqueValues).toBe(entry.id === 'micro-bare-strings');
      }
      const rows = instruments(doc);
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
      if (original.events.length) expect(rows.length).toBeGreaterThan(0);
      const isolated = [];
      for (const row of rows) {
        const code = generate(doc, { only: row.id });
        // Reuse the independently evaluated whole program only for identical source.
        const result = code === fresh ? regenerated : await queryEventsNode(code, 0, end);
        expect(result.error).toEqual(original.error);
        isolated.push(...result.events);
      }
      // all() is applied to each isolated score, too. The corpus's slow transform
      // distributes over stack, so its event multiset must also partition exactly.
      if (rows.length) expect(events(isolated), entry.id).toEqual(events(original.events));
    });
});

const local =
  '/home/aaron/projects/monkeyboys-modular-synth/src/library/patches/switch-angel-trance-demo.strudel';
it.skipIf(!existsSync(local))(
  'local-only composition: events and idempotence (no snapshots)',
  async () => {
    // Never include source, documents or generated text in assertion messages.
    const source = readFileSync(local, 'utf8');
    const first = importStrudel(source).doc;
    const fresh = generate(first);
    expect(checkDoc(first).length).toBe(0);
    expect(stable(clean(importStrudel(fresh).doc)) === stable(clean(first))).toBe(true);
    const a = await queryEvents(source, 0, 17),
      b = await queryEvents(fresh, 0, 17);
    expect(a.error === null && b.error === null).toBe(true);
    expect(stable(a) === stable(b)).toBe(true);
    const rows = instruments(first);
    expect(rows.length > 0 && new Set(rows.map((row) => row.id)).size === rows.length).toBe(true);
    const isolated = [];
    for (const row of rows) {
      const result = await queryEventsNode(generate(first, { only: row.id }), 0, 17);
      expect(result.error === null && !result.opaqueValues).toBe(true);
      isolated.push(...result.events);
    }
    expect(stable(events(isolated)) === stable(events(a.events))).toBe(true);
  },
);

describe('typed mini notation', () => {
  it.each([
    ['bd(3,8,1)', 'euclid'],
    ['{a b,c d e}%4', 'polymeter'],
    ['a|b', 'choose'],
    ['[a b]', 'sub'],
    ['<a b>', 'alternate'],
    ['[a,b]', 'together'],
    ['a*2', 'other'],
    ['a/3', 'other'],
    ['a:2', 'other'],
  ])('%s becomes %s', (text, kind) => expect(parseSteps(text)[0].kind).toBe(kind));
  it('models weights, repeats and degradation without changing their order', () => {
    expect(parseSteps('a@2 b!3 c?0.2 ~')).toEqual([
      { kind: 'value', value: 'a', weight: 2 },
      { kind: 'value', value: 'b', repeat: 3 },
      { kind: 'value', value: 'c', chance: 0.2 },
      { kind: 'rest' },
    ]);
  });
  it.each([
    'a@2 b!3 c?',
    '[a b,c d]',
    '<a [b c]>',
    'a [b|c] d',
    '{a b,c d e}%4',
    'bd(3,8,1)',
    'a*2 b/3',
    'a!3@2',
    'a?0.2!3',
    '<a b,c d> x',
  ])('mini generation preserves events: %s', async (text) => {
    await equivalent(`s(${JSON.stringify(text)})`, 4);
  });
  it('can regenerate an edited step and a rest retaining its previous value', () => {
    expect(printSteps([{ kind: 'rest', was: 'bd', weight: 2 }])).toBe('~@2');
    const doc = importStrudel('"bd hh"').doc;
    const core = voices(doc)[0].pattern.core;
    if (core.kind !== 'sequence') throw Error('Expected sequence');
    core.steps[0] = { kind: 'value', value: 'cp' };
    expect(generate(doc)).toContain('cp hh');
  });
});

describe('vocabulary and muting', () => {
  it('only labels and constants are author names; adjacent comments stay comments', async () => {
    const { doc } = await equivalent(
      '// A drum comment\n$: s("bd"); hats: s("hh"); const lead=note(60); lead',
    );
    expect(voices(doc).map((v) => [v.nameSource, v.name])).toEqual([
      ['generated', 'Instrument 1'],
      ['author', 'hats'],
      ['author', 'lead'],
    ]);
    expect(voices(doc)[0].pattern.comment).toBe('A drum comment');
    expect(voices(doc)[0].pattern.label).toBeUndefined();
  });
  it('keeps muted voices, nested patterns and group parts editable', async () => {
    const doc = importStrudel('hats: s("hh"); _$: s("cp"); stack(s("bd"),note(60))').doc;
    const p = voices(doc)[2].pattern;
    p.muted = true;
    if (p.core.kind !== 'group') throw Error('Expected group');
    p.core.parts[0].muted = true;
    p.core.parts[0].label = 'Kick';
    p.core.parts[0].pattern.comment = 'Kick comment';
    p.core.parts[0].pattern.muted = true;
    p.core.parts[1].label = 'Lead';
    p.core.parts[1].muted = false;
    p.core.parts[1].pattern.comment = 'Lead comment';
    const fresh = generate(doc);
    expect(clean(importStrudel(fresh).doc)).toEqual(clean(doc));
    expect((await queryEvents(fresh, 0, 1)).events.map((e) => e.value)).toEqual([{ s: 'hh' }]);
  });
  it('retains const vocabulary and comments on sections', async () => {
    const { doc } = await equivalent(
      'const kick=s("bd");\n// Intro comment\nconst intro=stack(kick); arrange([4,intro],[4,silence])',
    );
    expect(stable(doc)).toContain('Intro comment');
    expect(stable(doc)).toContain('"label":"intro"');
    expect(stable(doc)).toContain('"label":"kick"');
  });
});

describe('ordering boundaries', () => {
  it('independent controls form an unordered bag', async () => {
    const a = await equivalent('note(60).gain(.2).pan(.3)');
    const b = await equivalent('note(60).pan(.3).gain(.2)');
    expect(a.result.events).toEqual(b.result.events);
    expect(a.fresh).toBe(b.fresh);
  });
  it.each([
    ['note(60).gain(.2).pan(.3).gain(.8)', ['settings', 'settings']],
    ['note(60).lpf(800).gain(.5).lfo({rate:4})', ['settings', 'gain', 'lfo']],
    ['note(60).FX(lpf(500)).FX(gain(.5)).delay(.3)', ['FX', 'FX', 'settings']],
    ['note("c3 d3").fast(2).gain(".1 .5 .9").slow(3)', ['fast', 'settings', 'slow']],
  ])('keeps the ordering of %s', async (source, names) => {
    const { doc } = await equivalent(source);
    expect(
      voices(doc)[0].pattern.layers.map((l) => (l.kind === 'rewrite' ? l.name : l.kind)),
    ).toEqual(names);
  });
  it('retains interleaved setup, shared declarations, tempos, voices and transforms', async () => {
    const { doc } = await equivalent(
      'setcpm(30); const motif=note(60); $: motif; setcps(1); all(p=>p.slow(2)); $: motif.fast(2)',
    );
    expect(doc.body.map((n) => n.kind)).toEqual([
      'tempo',
      'shared',
      'voice',
      'tempo',
      'transform',
      'voice',
    ]);
  });
  it.each([
    'let x=60; x+=2; note(x)',
    '// mini-off\nnote("60 64")\n// mini-on',
    'const x=60; note(64).withValue(v=>({...v,note:x}))',
  ])('retains unsupported source: %s', async (source) => {
    await equivalent(source);
  });
});

describe('no-audio evaluator', () => {
  it('exposes evaluation errors and query failures, including partial results', async () => {
    expect(await queryEvents('missing()', 0, 1)).toMatchObject({ error: { phase: 'evaluation' } });
    expect(await queryEvents('silence', 0, 1)).toMatchObject({ error: null, events: [] });
    expect(await queryEvents("new Pattern(()=>{throw Error('broken')})", 0, 1)).toMatchObject({
      error: { phase: 'query', message: 'broken' },
    });
  });
  it('uses tempo, slider, register, fill and numeric plain spans', async () => {
    const result = await queryEvents(
      'setCpm(pure(120)); register(\'customGain\',(x,p)=>p.gain(x)); s("bd").customGain(slider(.4)).fill(.8).slow(2)',
      0.5,
      1.5,
    );
    expect(result).toMatchObject({
      cps: 2,
      error: null,
      opaqueValues: false,
      events: [
        {
          whole: [0, 2],
          part: [0.5, 1],
          hasOnset: false,
          value: { s: 'bd', gain: 0.4, fill: 0.8 },
        },
        { part: [1, 1.5] },
      ],
    });
    expect(() => structuredClone(result)).not.toThrow();
  });
  it('enforces an event budget', async () =>
    expect(await queryEventsWithBudget('s("bd*8")', 0, 1, 4)).toMatchObject({
      error: { phase: 'query', message: expect.stringContaining('event budget') },
    }));
  it.each([
    'while(true){}; silence',
    'new Pattern(()=>{while(true){}})',
    'await new Promise(()=>{}); silence',
  ])('a fresh Node worker interrupts %s', async (source) => {
    const result = await queryEventsNode(source, 0, 1, { timeoutMs: 700 });
    expect(result.error?.phase).toBe('timeout');
  });
  it('runs real Strudel in a fresh Node worker', async () =>
    expect(await queryEventsNode('note(60)', 0, 1)).toMatchObject({
      error: null,
      events: [{ value: { note: 60 } }],
    }));
});

describe('pinned adapters and host boundaries', () => {
  it('reads the pinned registry and canonical aliases through the Strudel seam', () => {
    expect(controlNames.size).toBeGreaterThan(400);
    expect(controlNames.get('lpf')).toBe('cutoff');
    expect(controlNames.get('sound')).toBe('s');
  });
  it('restores registered methods and output stand-ins after each question', async () => {
    const source = "register('temporaryGain',(x,p)=>p.gain(x)); note(60).temporaryGain(.2).scope()";
    expect((await queryEvents(source, 0, 1)).error).toBeNull();
    expect((await queryEvents('note(60).temporaryGain(.4)', 0, 1)).error?.phase).toBe('evaluation');
    expect((await queryEvents('note(60)', 0, 1)).events[0].value).toEqual({ note: 60 });
  });
  it('evaluates correctly across concurrent callers', async () => {
    const [a, b] = await Promise.all([
      queryEvents('setcpm(60); a: note(60)', 0, 1),
      queryEvents('setcpm(120); b: note(64)', 0, 1),
    ]);
    expect(a.cps).toBe(1);
    expect(b.cps).toBe(2);
    expect(a.events[0].value).toEqual({ note: 60 });
    expect(b.events[0].value).toEqual({ note: 64 });
  });
  it('bundles import, generation and no-audio evaluation for the browser', async () => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: { entry: new URL('./corpus/browser.ts', import.meta.url).pathname, formats: ['es'] },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    expect(outputs.length).toBeGreaterThan(0);
  });
  it('never throws on parsed opaque source and rejects only unparseable JavaScript', () => {
    expect(() => importStrudel('custom?.["call"]?.()')).not.toThrow();
    expect(() => importStrudel('note(')).toThrow(SyntaxError);
  });
  it('reports semantic tier totals across all indexed programs', () => {
    const totals = { 1: 0, 2: 0, 3: 0 };
    for (const entry of index) {
      const source = readFileSync(new URL(`../corpus/${entry.file}`, import.meta.url), 'utf8');
      const t = tierTotals(importStrudel(source).doc);
      totals[1] += t[1];
      totals[2] += t[2];
      totals[3] += t[3];
    }
    console.log(`Corpus semantic tiers (85 programs): ${JSON.stringify(totals)}`);
  });
});
