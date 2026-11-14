import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createRetention, documentJSON, readDocument, RECOVERY_KEY } from '../src/app/retention';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';
import { setConstant } from '../src/document/edit';
import { walk } from '../src/document';
import { queryEventsNode } from './node-query';

const kiln = importStrudel(readFileSync('corpus/programs/piece-kiln.strudel', 'utf8')).doc;
it('Kiln visual document retains IDs and v2 structure; JSON and fresh source retain events', async () => {
  let id = '';
  walk(kiln, (n) => {
    if ('name' in n && n.name === 'cutoff') id = n.id;
  });
  expect(id).not.toBe('');
  const edited = setConstant(kiln, id, 900);
  if ('ok' in edited) throw Error(edited.reason);
  const restored = readDocument(documentJSON(edited));
  expect(restored).toEqual(edited);
  expect(restored).not.toEqual(kiln);
  const expected = await queryEventsNode(generate(edited), 0, 32);
  expect(expected.error).toBeNull();
  expect(await queryEventsNode(generate(restored), 0, 32)).toEqual(expected);
  expect(await queryEventsNode(generate(importStrudel(generate(edited)).doc), 0, 32)).toEqual(
    expected,
  );
});

it('one snapshot waits for adoption, writes only revisions, and isolates namespaces/suspension', () => {
  const data = new Map([[RECOVERY_KEY, documentJSON(kiln)]]);
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
  const recovery = createRetention({ storage: () => storage });
  expect(recovery.candidate).toEqual(kiln);
  recovery.record({ ...kiln });
  expect(storage.setItem).not.toHaveBeenCalled();
  recovery.adopt();
  recovery.record(kiln);
  recovery.record(kiln);
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  recovery.suspend(true);
  recovery.record({ ...kiln });
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  const practice = createRetention({ namespace: 'practice', storage: () => storage });
  practice.record({ ...kiln, body: [] });
  expect(readDocument(data.get(RECOVERY_KEY)!)).toEqual(kiln);
  expect(readDocument(data.get('practice')!).body).toEqual([]);
});

it('denied, full and corrupt storage give visible notices without throwing', () => {
  const denied = createRetention({
    storage: () => {
      throw Error('denied');
    },
  });
  expect(denied.notice).toContain('could not be read');
  denied.record(kiln);
  expect(denied.notice).toContain('could not be saved');
  const full = createRetention({
    storage: () => ({
      getItem: () => null,
      setItem: () => {
        throw Error('QuotaExceededError');
      },
    }),
  });
  full.record(kiln);
  expect(full.notice).toContain('full');
  for (const text of ['{', '{"version":99,"body":[]}', '{"version":2,"body":[{}]}']) {
    const setItem = vi.fn();
    const corrupt = createRetention({ storage: () => ({ getItem: () => text, setItem }) });
    expect(corrupt.candidate).toBeNull();
    expect(corrupt.notice).toContain('could not be read');
    expect(setItem).not.toHaveBeenCalled();
  }
});
