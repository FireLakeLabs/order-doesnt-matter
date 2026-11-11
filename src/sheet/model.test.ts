import { describe, expect, it } from 'vitest';
import { checkDoc, instruments } from '../document';
import { fixtures, trio, arrange, missing, broken, dense, irregular } from './fixtures';
import { importStrudel } from '../import';
import { DRAW_CAP, sheetModel } from './model';

const cell = (name: string, row = 0, input = trio) =>
  sheetModel(input).rows[row].cells.find((c) => c.name === name)!;
describe('score sheet model', () => {
  it('uses valid JSON documents and keeps body order, names, provenance and mute', () => {
    for (const fixture of Object.values(fixtures)) expect(checkDoc(fixture.doc)).toEqual([]);
    const rows = sheetModel(trio).rows;
    expect(
      rows.map(({ id, name, nameSource, muted }) => ({ id, name, nameSource, muted })),
    ).toEqual([
      { id: 'lead', name: 'Lantern', nameSource: 'author', muted: false },
      { id: 'bass', name: 'Sine 1', nameSource: 'generated', muted: false },
      { id: 'bell', name: 'Glass', nameSource: 'author', muted: true },
    ]);
    expect(JSON.stringify(rows)).not.toContain('Do not call this');
  });
  it('draws only used columns, pitch/sound first, then first appearance', () => {
    expect(sheetModel(trio).columns).toEqual(['rhythm', 'note', 's', 'gain', 'lpf', 'pan', 'room']);
    expect(cell('gain')).toMatchObject({ kind: 'constant', values: [0], nodeId: 'lead-gain' });
    expect(cell('gain', 1)).toMatchObject({
      kind: 'unused',
      summary: 'gain: not used',
      values: [],
    });
  });
  it('uses real event values and spans, including canonical engine setting keys', () => {
    expect(cell('lpf')).toMatchObject({ kind: 'steps', values: [400, 2000, 700], changes: 2 });
    expect(cell('lpf').marks.map(({ start, end, value }) => [start, end, value])).toEqual([
      [0, 0.5, 400],
      [0.5, 0.75, 2000],
      [0.75, 1, 700],
    ]);
    expect(cell('lpf').summary).toContain('400 to 2000');
    expect(cell('rhythm', 0, irregular).marks.map(({ start, end }) => [start, end])).toEqual(
      irregular.events.odd.events.map((e) => e.whole),
    );
  });
  it('keeps whole spans, clips drawing to the window and excludes outside parts', () => {
    const input = structuredClone(trio);
    input.fromCycle = 0.6;
    input.toCycle = 0.8;
    input.playhead = 0.7;
    const rhythm = cell('rhythm', 0, input);
    expect(rhythm.totalCount).toBe(2);
    expect(rhythm.marks[0]).toMatchObject({ start: 0.5, end: 0.75, x: 0 });
    expect(rhythm.marks[0].width).toBeCloseTo(75);
    expect(sheetModel(input).playheadX).toBeCloseTo(50);
  });
  it('draws a sampled setting and events without whole as curves, never notes', () => {
    expect(cell('pan', 1)).toMatchObject({ kind: 'curve', totalCount: 2 });
    expect(cell('pan', 1).path).toMatch(/^M/);
    expect(cell('rhythm', 1, irregular)).toMatchObject({ kind: 'curve', totalCount: 4 });
  });
  it('retains notes alongside continuous events without turning either into the other', () => {
    const input = structuredClone(irregular);
    input.events.odd.events.push(...input.events.signal.events);
    const rhythm = cell('rhythm', 0, input);
    expect(rhythm.marks.filter((m) => !m.signal)).toHaveLength(5);
    expect(rhythm.marks.filter((m) => m.signal)).toHaveLength(4);
    expect(rhythm.path.split(' ').map((point) => point.split(',')[0])).toEqual([
      'M0',
      'L25',
      'L50',
      'L75',
      'L100',
    ]);
  });
  it('resolves shared signal drivers without exposing their inner settings as columns', () => {
    const input = structuredClone(trio);
    input.doc.body.unshift({
      id: 'driver',
      tier: 1,
      kind: 'shared',
      name: 'drift',
      pattern: { id: 'shared-drift', tier: 1, core: { kind: 'signal', shape: 'sine' }, layers: [] },
    });
    const bass = input.doc.body.find((v) => v.kind === 'voice' && v.id === 'bass');
    if (!bass || bass.kind !== 'voice' || bass.pattern.layers[0].kind !== 'settings')
      throw Error('Fixture missing bass setting');
    bass.pattern.layers[0].settings[0].value.core = { kind: 'ref', name: 'drift' };
    expect(cell('pan', 1, input).kind).toBe('curve');
    const driver = bass.pattern.layers[0].settings[0].value;
    driver.layers.push({
      id: 'driver-gain',
      tier: 1,
      kind: 'settings',
      settings: [
        {
          id: 'inner-drive',
          tier: 1,
          name: 'inner',
          value: { id: 'inner-value', tier: 1, core: { kind: 'constant', value: 3 }, layers: [] },
        },
      ],
    });
    expect(sheetModel(input).columns).not.toContain('inner');
  });
  it('matches every used sound by name; missing and broken remain explicit', () => {
    expect(sheetModel(trio).rows[0].sounds).toEqual([{ name: 'triangle', state: 'ready' }]);
    expect(sheetModel(trio).rows[1].sounds).toEqual([{ name: 'sine', state: 'loading' }]);
    expect(sheetModel(missing).rows[0].sounds).toEqual(missing.sounds);
    expect(sheetModel(broken).rows[0]).toMatchObject({
      broken: 'Cannot query custom rewrite',
      status: 'Broken: Cannot query custom rewrite',
    });
    const input = structuredClone(trio);
    input.events.lead.events[0].value = { s: ['triangle', 'unknown'] };
    expect(sheetModel(input).rows[0].sounds).toContainEqual({
      name: 'unknown',
      state: 'not-loaded',
    });
  });
  it('lets the last setting replace a signal driver', () => {
    const input = structuredClone(trio);
    const bass = input.doc.body.find((v) => v.kind === 'voice' && v.id === 'bass');
    if (!bass || bass.kind !== 'voice') throw Error('Fixture missing bass');
    bass.pattern.layers.push({
      id: 'override',
      tier: 1,
      kind: 'settings',
      settings: [
        {
          id: 'pan-override',
          tier: 1,
          name: 'pan',
          value: {
            id: 'pan-constant',
            tier: 1,
            core: { kind: 'constant', value: 0.4 },
            layers: [],
          },
        },
      ],
    });
    input.events.bass.events.forEach((e) => {
      e.value = { s: 'sine', pan: 0.4 };
    });
    expect(cell('pan', 1, input)).toMatchObject({
      kind: 'constant',
      values: [0.4],
      nodeId: 'pan-override',
    });
  });
  it('preserves rewrite order, argument summaries, source text and node identities', () => {
    expect(sheetModel(trio).rows[0].rewrites).toEqual([
      { nodeId: 'lead-fast', name: 'fast', summary: '2', source: false },
      { nodeId: 'lead-source', name: 'Source text', summary: '.customScore()', source: true },
      { nodeId: 'lead-rev', name: 'rev', summary: '', source: false },
    ]);
  });
  it('lays out four labelled sections proportionally and marks sit-outs and now', () => {
    const sections = sheetModel(arrange).sections;
    expect(
      sections.map(({ name, start, cycles, width, current }) => [
        name,
        start,
        cycles,
        width,
        current,
      ]),
    ).toEqual([
      ['Opening', 0, 2, 25, false],
      ['Build', 2, 1, 12.5, false],
      ['Space', 3, 3, 37.5, true],
      ['Return', 6, 2, 25, false],
    ]);
    expect(sections[2].instruments).toContainEqual({
      id: 'spark',
      name: 'Spark',
      state: 'absent',
      text: 'Spark: not in this section',
    });
    expect(sheetModel({ ...arrange, playhead: 12 }).sections[2].current).toBe(true);
    expect(sheetModel(trio).sections).toEqual([]);
  });
  it('caps drawing while retaining true counts and samples the full window', () => {
    const rhythm = cell('rhythm', 0, dense);
    expect(rhythm.totalCount).toBe(640);
    expect(rhythm.marks).toHaveLength(DRAW_CAP);
    expect(rhythm.summary).toContain('200 of 640');
    expect(rhythm.marks.at(-1)!.start).toBe(639 / 640);
  });
  it('handles opaque event values and rejects an invalid query window', () => {
    const input = structuredClone(trio);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    input.events.lead.events[0].value = { custom: cyclic };
    expect(cell('custom', 0, input).label).toBe('[opaque value]');
    expect(() => sheetModel({ ...trio, toCycle: 0 })).toThrow('finite and increasing');
  });
  it('knows section membership without querying that section', () => {
    const input = { ...arrange, toCycle: 1 };
    expect(sheetModel(input).sections[2].instruments[1].state).toBe('absent');
    expect(sheetModel(input).sections[2].instruments[0].state).toBe('present');
  });
  it('uses instrument definitions and keeps use-site settings and rewrites separate', () => {
    const doc = importStrudel(
      'const chords=note(60).s("piano").lpf(900).slow(2); const intro=stack(chords.lpf(600).pan(.3).fast(2),s("hh").pan(.5)); arrange([4,intro],[4,chords])',
    ).doc;
    const rows = instruments(doc);
    const input = {
      ...trio,
      doc,
      events: {
        [rows[0].id]: {
          ...trio.events.lead,
          events: [
            {
              whole: [0, 1] as [number, number],
              part: [0, 1] as [number, number],
              hasOnset: true,
              value: { note: 60, s: 'piano', cutoff: 600, pan: 0.3 },
            },
          ],
        },
      },
    };
    const model = sheetModel(input);
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0].rewrites.map((r) => r.name)).toEqual(['slow']);
    expect(model.rows[0].useNotes).toContain('in intro: lpf 600; pan 0.3; fast 2');
    expect(model.rows[0].cells.find((c) => c.name === 'lpf')?.values).toEqual([900]);
    expect(model.rows[0].status).toBe('1 event');
    expect(model.rows[0].cells.find((c) => c.name === 'pan')).toMatchObject({
      kind: 'unused',
      values: [],
      marks: [],
    });
    expect(model.rows[0].cells.find((c) => c.name === 's')?.kind).toBe('constant');
    expect(model.rows[0].cells.find((c) => c.name === 'rhythm')?.values).toEqual([60]);
  });
  it('distinguishes quiet, unqueried and broken from unused, and hides stopped/outside playheads', () => {
    const input = structuredClone(trio);
    input.events.lead.events = [];
    expect(cell('gain', 0, input).kind).toBe('empty');
    delete input.events.lead;
    expect(sheetModel(input).rows[0].status).toBe('Not queried');
    expect(cell('rhythm', 0, broken).summary).toContain('Broken: Cannot query custom rewrite');
    expect(sheetModel({ ...trio, playhead: null }).playheadX).toBeNull();
    expect(sheetModel({ ...trio, playhead: 1 }).playheadX).toBeNull();
  });
});

it('unpitched rhythm names the hit count instead of a generic event', () => {
  const input = structuredClone(trio);
  input.events.lead.events.forEach((e) => {
    e.value = { s: 'bd' };
  });
  const model = sheetModel(input);
  const rhythm = model.rows[0].cells.find((c) => c.name === 'rhythm')!;
  expect(rhythm.label).toBe(`${rhythm.totalCount} hits`);
});
