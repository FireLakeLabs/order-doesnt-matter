import { expect, test, vi } from 'vitest';
import {
  createSession,
  layoutKey,
  parseLayout,
  soloEdit,
  soloedInstrument,
} from '../src/studio/session';
import { importStrudel } from '../src/import';
import { instruments } from '../src/document';
import { setMuted } from '../src/document/edits/set-muted';

const ids = ['test-card', 'ring'];
test('layout parsing validates all fields and gives explicit links precedence', () => {
  const stored = JSON.stringify({
    a: 'ring',
    b: 'test-card',
    lookAhead: 8,
    trails: 2,
    theme: 'riso',
  });
  expect(parseLayout(stored, '?a=test-card&b=&theme=phosphor', ids)).toEqual({
    a: 'test-card',
    b: null,
    lookAhead: 8,
    trails: 2,
    theme: 'phosphor',
  });
  for (const invalid of [
    'oops',
    'null',
    '4',
    '[]',
    JSON.stringify({ a: {}, b: 'unknown', lookAhead: -1, trails: '2', theme: 'toString' }),
  ]) {
    const result = parseLayout(invalid, '', ids);
    expect(result.lookAhead).toBe(4);
    expect(result.trails).toBe(1);
    expect(result.theme).toBe('arcade');
    expect(result.b).toBeNull();
  }
  expect(parseLayout(stored, '?a=unknown&theme=unknown', ids)).toMatchObject({
    a: null,
    theme: 'arcade',
  });
});
test('session selection is shared and only the layout persists; denied writes remain usable', () => {
  const storage = { getItem: vi.fn(), setItem: vi.fn() };
  const session = createSession(parseLayout(null, '', ids), storage);
  const notify = vi.fn();
  const off = session.subscribe(notify);
  const first = session.getSnapshot();
  expect(session.getSnapshot()).toBe(first);
  session.selectInstrument('bd');
  session.fill('b');
  expect(storage.setItem).not.toHaveBeenCalled();
  session.layout({ b: 'ring', lookAhead: 2, trails: 0 });
  expect(JSON.parse(storage.setItem.mock.calls[0][1] as string)).toEqual(
    session.getSnapshot().layout,
  );
  expect(storage.setItem.mock.calls[0][0]).toBe(layoutKey);
  storage.setItem.mockImplementation(() => {
    throw Error('Denied');
  });
  expect(() => session.layout({ theme: 'pocket' })).not.toThrow();
  expect(session.getSnapshot()).toMatchObject({
    selectedInstrument: 'bd',
    filledStage: 'b',
    layout: { theme: 'pocket' },
  });
  off();
  expect(notify).toHaveBeenCalledTimes(4);
});
test('solo is one document candidate and restores prior mutes, including switched solos and history identities', () => {
  const initial = importStrudel('stack(s("bd"), s("sd"), s("hh"))').doc;
  const rows = instruments(initial);
  const muted = setMuted(initial, rows[2].id, true);
  if ('ok' in muted) throw Error(muted.reason);
  const solo = soloEdit(muted, rows[0].id);
  expect(instruments(solo).map((row) => row.muted)).toEqual([false, true, true]);
  expect(soloedInstrument(solo)).toBe(rows[0].id);
  const switched = soloEdit(solo, rows[1].id);
  expect(instruments(switched).map((row) => row.muted)).toEqual([true, false, true]);
  expect(instruments(soloEdit(switched, rows[1].id)).map((row) => row.muted)).toEqual([
    false,
    false,
    true,
  ]);
  expect(soloedInstrument(muted)).toBeNull();
  expect(soloedInstrument(solo)).toBe(rows[0].id);
});
