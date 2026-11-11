import { expect, test, vi } from 'vitest';
import { Pattern, pure } from '@strudel/core';
import { guarded } from './audio-pattern';

test('Cyclist queryArc guard surfaces direct-query errors instead of swallowing them', () => {
  const failed = vi.fn(),
    tag = vi.fn();
  expect(
    guarded(
      new Pattern(() => {
        throw Error('late query failure');
      }),
      failed,
      tag,
    ).queryArc(8, 9),
  ).toEqual([]);
  expect(failed.mock.calls[0][0].message).toBe('late query failure');
  expect(guarded(pure('a'), failed, tag).queryArc(0, 1)).toHaveLength(1);
  expect(tag).toHaveBeenCalledOnce();
});
