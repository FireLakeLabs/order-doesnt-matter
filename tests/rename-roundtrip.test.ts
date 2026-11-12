import { expect, it } from 'vitest';
import { instruments } from '../src/document';
import { renameInstrument } from '../src/document/edits/rename-instrument';
import { generate } from '../src/generate';
import { importStrudel } from '../src/import';
import { queryEvents } from '../src/strudel/evaluate';

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'id' && key !== 'span')
      .map(([key, item]) => [key, clean(item)]),
  );
}
it('shared instrument rename survives generation and re-import without renaming references', async () => {
  const original = importStrudel(
    'const bass=note("36 40").s("sine"); arrange([2,bass],[2,bass.fast(2)])',
  ).doc;
  const renamed = renameInstrument(original, instruments(original)[0].id, 'Low end');
  if ('ok' in renamed) throw Error(renamed.reason);
  const code = generate(renamed);
  const round = importStrudel(code).doc;
  expect(instruments(round)[0]).toMatchObject({ name: 'Low end', nameSource: 'author' });
  expect(clean(round)).toEqual(clean(renamed));
  expect(generate(round)).toBe(code);
  expect(code).toContain('const bass =');
  expect(code).toContain('bass.fast(2)');
  const before = await queryEvents(generate(original), 0, 8);
  const after = await queryEvents(generate(round), 0, 8);
  expect(before.error).toBeNull();
  expect(after).toEqual(before);
});
it('shared bindings without generated labels still supply the author name', () => {
  expect(instruments(importStrudel('const bass=note(36); bass').doc)[0]).toMatchObject({
    name: 'bass',
    nameSource: 'author',
  });
});
