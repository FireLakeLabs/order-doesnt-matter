import { expect, it } from 'vitest';
import { initialState, mergeSounds, observeSoundNotice } from '../src/app/state';
import type { SheetSoundState } from '../src/contract';

it('new sound names progress from not loaded through loading to ready or missing', () => {
  let sounds = mergeSounds([], ['fresh', 'absent'], []);
  expect(sounds).toEqual([
    { name: 'fresh', state: 'not-loaded' },
    { name: 'absent', state: 'not-loaded' },
  ]);
  sounds = mergeSounds(
    sounds,
    ['fresh', 'absent'],
    [
      { name: 'fresh', state: 'loading' },
      { name: 'absent', state: 'loading' },
    ],
  );
  expect(sounds.map((s) => s.state)).toEqual(['loading', 'loading']);
  expect(
    mergeSounds(
      sounds,
      ['fresh', 'absent'],
      [
        { name: 'fresh', state: 'ready' },
        { name: 'absent', state: 'missing', detail: 'Unknown sound' },
      ],
    ),
  ).toEqual([
    { name: 'fresh', state: 'ready' },
    { name: 'absent', state: 'missing', detail: 'Unknown sound' },
  ]);
});
it('removes unused names even when an older engine snapshot still includes them', () => {
  const old: SheetSoundState[] = [{ name: 'removed', state: 'ready' }];
  const before = structuredClone(old);
  expect(mergeSounds(old, ['fresh', 'fresh'], old)).toEqual([
    { name: 'fresh', state: 'not-loaded' },
  ]);
  expect(mergeSounds(old, [], old)).toEqual([]);
  expect(old).toEqual(before);
});
it('keeps the base sound state for indexed names without retaining unrelated names', () => {
  expect(
    mergeSounds(
      [{ name: 'old', state: 'missing' }],
      ['kick:2', 'kick:3'],
      [{ name: 'kick', state: 'ready' }],
    ),
  ).toEqual([{ name: 'kick', state: 'ready' }]);
});
it('a dismissed default-load notice returns only for a later failure transition', () => {
  const failed: SheetSoundState[] = [
    { name: 'kick', state: 'missing', detail: 'Default collections could not load' },
    { name: 'clap', state: 'missing', detail: 'Default collections could not load' },
  ];
  let notice = observeSoundNotice(initialState().soundNotice, failed);
  expect(notice.visible).toBe(true); // One notice even with two missing sounds.
  notice = { ...notice, visible: false };
  expect(observeSoundNotice(notice, failed).visible).toBe(false);
  notice = observeSoundNotice(notice, []); // A later attempt, not another failure.
  expect(notice.visible).toBe(false);
  notice = observeSoundNotice(notice, [{ name: 'kick', state: 'loading' }]);
  expect(notice.visible).toBe(false);
  notice = observeSoundNotice(notice, [{ name: 'kick', state: 'ready' }]);
  expect(notice.visible).toBe(false);
  notice = observeSoundNotice(notice, [
    { name: 'other', state: 'missing', detail: 'Unknown sound' },
  ]);
  expect(notice.visible).toBe(false);
  notice = observeSoundNotice(notice, failed);
  expect(notice.visible).toBe(true);
});
