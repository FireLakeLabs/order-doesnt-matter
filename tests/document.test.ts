import { expect, test } from 'vitest';
import { checkDoc, findById, shared, tempo, voices, walk } from '../src/document/index';
import type { Doc } from '../src/document/index';
import { fixture } from '../src/document/fixture';

test('all-variant fixture is valid plain JSON and selectors preserve order', () => {
  expect(checkDoc(fixture)).toEqual([]);
  expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  expect(voices(fixture).map((v) => v.name)).toEqual(['Example']);
  expect(shared(fixture, 'theme')?.label).toBe('theme');
  expect(shared(fixture, 'absent')).toBeUndefined();
  expect(tempo(fixture)).toBe(120);
  expect(tempo({ version: 1, body: [] })).toBeUndefined();
});

test('walk visits every Meta exactly once at its JSON path; find uses stable ids', () => {
  const expected: string[] = [];
  const json = JSON.stringify(fixture, (_key, value) => {
    if (value && typeof value === 'object' && 'id' in value) expected.push(value.id);
    return value;
  });
  const actual: string[] = [];
  walk(fixture, (node, path) => {
    actual.push(node.id);
    expect(
      path.reduce<unknown>(
        (value, key) => (value as Record<string | number, unknown>)[key],
        fixture,
      ),
    ).toBe(node);
    expect(findById(fixture, node.id)).toBe(node);
  });
  expect(actual).toEqual(expected);
  expect(findById(JSON.parse(json), 'absent')).toBeUndefined();
});

test('checkDoc reports duplicate ids, missing shared refs and unsupported versions', () => {
  const broken = JSON.parse(JSON.stringify(fixture)) as Doc;
  broken.body.push({
    kind: 'shared',
    id: broken.body[0].id,
    tier: 1,
    name: 'bad',
    pattern: { id: 'bad-ref', tier: 1, core: { kind: 'ref', name: 'missing' }, layers: [] },
  });
  expect(checkDoc(broken).join('\n')).toMatch(/Duplicate id/);
  expect(checkDoc(broken).join('\n')).toMatch(/Missing shared.*missing/);
  expect(checkDoc({ ...broken, version: 2 } as unknown as Doc).join('\n')).toMatch(/version/);
});
