import { describe, expect, it } from 'vitest';
import { instruments, sections, type Doc, type Pattern, type Voice } from '../src/document';
import { importStrudel } from '../src/import';
import { readFileSync } from 'node:fs';

const leaf = (id: string, sound = 'cp'): Pattern => ({
  id,
  tier: 1,
  core: { kind: 'generator', name: 's', args: [{ kind: 'literal', value: sound }] },
  layers: [],
});
const ref = (id: string, name: string): Pattern => ({ ...leaf(id), core: { kind: 'ref', name } });
const group = (id: string, how: string, parts: Pattern[]): Pattern => ({
  ...leaf(id),
  core: { kind: 'group', how, parts: parts.map((pattern) => ({ pattern, cycles: 4 })) },
});
const voice = (pattern: Pattern, id = 'voice'): Voice => ({
  id,
  tier: 1,
  kind: 'voice',
  name: '$',
  nameSource: 'author',
  muted: false,
  pattern,
});
const shared = (name: string, pattern: Pattern): Doc['body'][number] => ({
  id: `shared-${name}`,
  tier: 1,
  kind: 'shared',
  name,
  pattern,
});
const doc = (...body: Doc['body']): Doc => ({ version: 1, body });

describe('derived instruments and sections', () => {
  it('deduplicates a shared leaf, retaining every path and use-site layer', () => {
    const uses = ['intro', 'drop', 'breakdown'].map((name) => ref(name, 'chords'));
    uses[0].layers = [
      {
        id: 'filter',
        tier: 1,
        kind: 'settings',
        settings: [
          {
            id: 'cutoff',
            tier: 1,
            name: 'lpf',
            value: { ...leaf('600'), core: { kind: 'constant', value: 600 } },
          },
        ],
      },
    ];
    const d = doc(shared('chords', leaf('chords')), voice(group('song', 'arrange', uses)));
    const rows = instruments(d);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'chords',
      name: 'chords',
      nameSource: 'author',
      muted: false,
    });
    expect(rows[0].uses.map((use) => use.path.map((node) => node.id))).toEqual([
      ['voice', 'song', 'intro', 'chords'],
      ['voice', 'song', 'drop', 'chords'],
      ['voice', 'song', 'breakdown', 'chords'],
    ]);
    expect(rows[0].uses[0].layers.map((layer) => layer.id)).toEqual(['filter']);
    expect(
      sections(d).map((s) => [s.name, s.nameSource, s.start, s.cycles, s.instrumentIds]),
    ).toEqual([
      ['chords', 'author', 0, 4, ['chords']],
      ['chords', 'author', 4, 4, ['chords']],
      ['chords', 'author', 8, 4, ['chords']],
    ]);
  });
  it('walks nested named groups and gives each inline leaf its own identity', () => {
    const d = doc(
      shared('percussion', group('drums', 'stack', [leaf('clap'), leaf('hat', 'hh')])),
      voice(
        group('song', 'arrange', [
          group('intro', 'stack', [ref('drums1', 'percussion'), leaf('inline')]),
          ref('drums2', 'percussion'),
        ]),
      ),
    );
    const rows = instruments(d);
    expect(rows.map((i) => [i.id, i.name, i.nameSource, i.uses.length])).toEqual([
      ['clap', 'percussion · cp', 'generated', 2],
      ['hat', 'percussion · hh', 'generated', 2],
      ['inline', 'Instrument 3', 'generated', 1],
    ]);
    expect(sections(d)[0]).toMatchObject({ name: 'Section 1', nameSource: 'generated' });
  });
  it('keeps single-pattern voice ids, author names and generated names; comments never name rows', () => {
    const a = voice(leaf('a-pattern'), 'a');
    a.name = 'kick';
    const b = voice({ ...leaf('b-pattern'), comment: 'A tempting name' }, 'b');
    const c = voice(leaf('c-pattern'), 'c');
    c.name = 'Sine 1';
    c.nameSource = 'generated';
    expect(instruments(doc(a, b, c)).map((i) => [i.id, i.name, i.nameSource])).toEqual([
      ['a', 'kick', 'author'],
      ['b', 'Instrument 2', 'generated'],
      ['c', 'Sine 1', 'generated'],
    ]);
    a.pattern.label = 'Label';
    expect(instruments(doc(a))[0].name).toBe('Label');
  });
  it('uses definition mute or every use mute, including muted parts and ancestors', () => {
    const target = leaf('target');
    const song = group('song', 'arrange', [ref('first', 'target'), ref('second', 'target')]);
    const d = doc(shared('target', target), voice(song));
    if (song.core.kind !== 'group') throw Error('group');
    song.core.parts[0].muted = true;
    expect(instruments(d)[0].muted).toBe(false);
    song.core.parts[1].pattern.muted = true;
    expect(instruments(d)[0].muted).toBe(true);
    song.core.parts[1].pattern.muted = false;
    target.muted = true;
    expect(instruments(d)[0].muted).toBe(true);
  });
  it('retains opaque, unknown and unresolved/cyclic reference leaves without looping', () => {
    const unknown = { ...leaf('unknown'), core: { kind: 'future' } } as unknown as Pattern;
    const d = doc(
      shared('loop', ref('loop-def', 'loop')),
      voice(
        group('g', 'stack', [
          { ...leaf('opaque'), core: { kind: 'opaque', code: 'custom()' } },
          unknown,
          ref('missing', 'missing'),
          ref('cycle', 'loop'),
        ]),
      ),
    );
    expect(instruments(d).map((i) => i.id)).toEqual(['opaque', 'unknown', 'missing', 'loop-def']);
  });
  it('uses top-level arrange only, follows refs, honors part labels and returns no strip for several voices', () => {
    const song = group('song', 'arrange', [leaf('one'), leaf('two')]);
    if (song.core.kind !== 'group') throw Error('group');
    song.core.parts[0].label = 'Opening';
    const d = doc(shared('song', song), voice(ref('root', 'song')));
    expect(sections(d).map((s) => [s.name, s.start, s.cycles])).toEqual([
      ['Opening', 0, 4],
      ['Section 2', 4, 4],
    ]);
    expect(sections(doc(voice(group('outer', 'stack', [song]))))).toEqual([]);
    expect(sections(doc(...d.body, voice(song, 'other')))).toEqual([]);
  });
});

const corpusDoc = (id: string) =>
  importStrudel(readFileSync(new URL(`../corpus/programs/${id}.strudel`, import.meta.url), 'utf8'))
    .doc;
it('real-house-arranged: musician-facing names, first appearance, sections and cycles', () => {
  const d = corpusDoc('real-house-arranged');
  expect(instruments(d).map((i) => i.name)).toEqual([
    'percussion · cp',
    'percussion · oh',
    'percussion · hh',
    'chords',
    'buildup · cp',
    'bass',
    'kick',
    'breakdown · triangle',
  ]);
  expect(sections(d).map((s) => [s.name, s.start, s.cycles])).toEqual([
    ['intro', 0, 4],
    ['buildSection', 4, 4],
    ['drop', 8, 8],
    ['breakdown', 16, 4],
    ['drop', 20, 8],
  ]);
});
it('real-dnb-arranged: names and section lengths', () => {
  const d = corpusDoc('real-dnb-arranged');
  expect(instruments(d).map((i) => i.name)).toEqual([
    'darkPad',
    'vocalIntro',
    'dnbDrums · bd',
    'dnbDrums · sd',
    'dnbDrums · hh',
    'dnbDrums · oh',
    'buildSection · sd',
    'reeseBass',
    'vocalStab',
    'breakdown · triangle',
  ]);
  expect(sections(d).map((s) => [s.name, s.cycles])).toEqual([
    ['intro', 4],
    ['buildSection', 4],
    ['drop', 8],
    ['breakdown', 4],
    ['drop', 8],
  ]);
});
it('real-house is five inline stack leaves; dollar/named single-pattern lines keep voice ids', () => {
  const d = corpusDoc('real-house');
  const root = d.body.find((n) => n.kind === 'voice')!;
  if (root.kind !== 'voice' || root.pattern.core.kind !== 'group') throw Error('corpus changed');
  expect(instruments(d).map((i) => i.id)).toEqual(root.pattern.core.parts.map((p) => p.pattern.id));
  const lines = importStrudel('$: s("bd"); hats: s("hh"); $: note(60).s("piano")').doc;
  expect(instruments(lines).map((i) => i.id)).toEqual(
    lines.body.filter((n) => n.kind === 'voice').map((v) => v.id),
  );
});

it('shared identity takes precedence across standalone voices, with per-use mute', () => {
  const d = doc(
    shared('kick', leaf('kick')),
    voice(ref('a', 'kick'), 'one'),
    voice(ref('b', 'kick'), 'two'),
  );
  const rows = instruments(d);
  expect(rows.map((i) => [i.id, i.uses.length])).toEqual([['kick', 2]]);
  expect(
    instruments(doc(shared('kick', leaf('kick')), voice(ref('single', 'kick'), 'one')))[0].id,
  ).toBe('one');
});

it('bare silence has timing but no row; decorated silence and unknown leaves remain rows', () => {
  const d = importStrudel('arrange([2,silence],[3,s("bd")],[1,silence.gain(.2)],[1,custom()])').doc;
  expect(instruments(d)).toHaveLength(3);
  expect(sections(d).map((s) => [s.start, s.cycles, s.instrumentIds.length])).toEqual([
    [0, 2, 0],
    [2, 3, 1],
    [5, 1, 1],
    [6, 1, 1],
  ]);
  const real = instruments(corpusDoc('real-dubstep-arranged'));
  expect(
    real.some(
      (r) =>
        r.pattern.core.kind === 'generator' &&
        r.pattern.core.name === 'silence' &&
        !r.pattern.layers.length,
    ),
  ).toBe(false);
  expect(real.some((r) => /^Instrument \d+$/.test(r.name))).toBe(false);
});
