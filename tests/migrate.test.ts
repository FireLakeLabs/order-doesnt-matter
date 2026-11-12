import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import fixtures from './fixtures/doc-v1.json';
import { migrate } from '../src/document/migrate';
import { checkDoc, instruments, sections, type Doc } from '../src/document';
import { generate } from '../src/generate';
import { queryEventsNode } from './node-query';
it('migrates captured first-party v1 programs without changing events or mutating fixtures', async () => {
  for (const fixture of fixtures) {
    const before = JSON.stringify(fixture.doc),
      doc = migrate(fixture.doc);
    expect(doc.version).toBe(2);
    expect(checkDoc(doc)).toEqual([]);
    expect(JSON.stringify(fixture.doc)).toBe(before);
    expect(await queryEventsNode(generate(doc), 0, 16)).toEqual(
      await queryEventsNode(readFileSync(`corpus/${fixture.program}`, 'utf8'), 0, 16),
    );
    expect(migrate(doc)).toBe(doc);
  }
});
it('migrates reserved section vocabulary and preserves canonical instrument ids', () => {
  const leaf = {
    id: 'drum',
    tier: 1,
    core: { kind: 'generator', name: 's', args: [{ kind: 'literal', value: 'bd' }] },
    layers: [],
  };
  const old = {
    version: 1,
    body: [
      {
        id: 'binding',
        tier: 1,
        kind: 'shared',
        name: '__odm_section_1',
        pattern: {
          id: 'section',
          tier: 1,
          label: 'Section 1',
          core: { kind: 'group', how: 'stack', parts: [{ pattern: leaf }] },
          layers: [],
        },
      },
      {
        id: 'voice',
        tier: 1,
        kind: 'voice',
        name: 'Song',
        nameSource: 'author',
        muted: false,
        pattern: {
          id: 'song',
          tier: 1,
          core: {
            kind: 'group',
            how: 'arrange',
            parts: [
              {
                cycles: 4,
                pattern: {
                  id: 'use',
                  tier: 1,
                  core: { kind: 'ref', name: '__odm_section_1' },
                  layers: [],
                },
              },
              {
                cycles: 4,
                label: 'Verse',
                pattern: {
                  id: 'use2',
                  tier: 1,
                  core: { kind: 'ref', name: '__odm_section_1' },
                  layers: [],
                },
              },
            ],
          },
          layers: [],
        },
      },
    ],
  };
  const doc = migrate(old);
  expect(checkDoc(doc)).toEqual([]);
  expect(sections(doc).map((s) => [s.name, s.nameSource])).toEqual([
    ['Section 1', 'generated'],
    ['Verse', 'author'],
  ]);
  expect(instruments(doc).map((r) => r.id)).toEqual(['drum']);
  expect(generate(doc)).not.toContain('__odm_section_');
});
it('rejects unsupported input with a clear error and validates v2 origins and provenance', () => {
  for (const value of [
    null,
    {},
    [],
    { version: 0, body: [] },
    { version: 3, body: [] },
    { version: 1 },
    { version: 1, body: [{}] },
  ])
    expect(() => migrate(value)).toThrow(/document|version/i);
  const doc = migrate({ version: 1, body: [] });
  expect(migrate(doc)).toBe(doc);
  expect(checkDoc({ ...doc, version: 1 } as unknown as Doc)).toContain(
    'Unsupported document version: 1',
  );
});
it('migrates a legacy generated section that is itself an instrument leaf', () => {
  const old = {
    version: 1,
    body: [
      {
        kind: 'shared',
        id: 'binding',
        tier: 1,
        name: '__odm_section_1',
        pattern: {
          id: 'leaf',
          tier: 1,
          label: 'Section 1',
          core: { kind: 'generator', name: 's', args: [{ kind: 'literal', value: 'bd' }] },
          layers: [],
        },
      },
      {
        kind: 'voice',
        id: 'voice',
        tier: 1,
        name: 'Song',
        nameSource: 'author',
        muted: false,
        pattern: {
          id: 'song',
          tier: 1,
          core: {
            kind: 'group',
            how: 'arrange',
            parts: [
              {
                cycles: 4,
                pattern: {
                  id: 'use',
                  tier: 1,
                  core: { kind: 'ref', name: '__odm_section_1' },
                  layers: [],
                },
              },
            ],
          },
          layers: [],
        },
      },
    ],
  };
  const doc = migrate(old);
  expect(checkDoc(doc)).toEqual([]);
  expect(instruments(doc).map((r) => r.id)).toEqual(['leaf']);
  expect(sections(doc)[0]).toMatchObject({ name: 'Section 1', nameSource: 'generated' });
});
