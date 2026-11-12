import { expect, test } from 'vitest';
import { pure, Pattern } from '@strudel/core';
import { profilePattern } from './playback-profile';

test('profile matches Cyclist anchors, covers 32 cycles at double tempo, and counts failed windows', () => {
  const result = profilePattern(pure('a'), 0.5, 2);
  expect(result.windows).toHaveLength(640);
  expect(result.windows[0]).toMatchObject({ begin: 0, end: 0.05, starts: 1 });
  expect(result.windows.at(-1)?.end).toBe(32);
  expect(result.peakStarts).toBe(1);
  const broken = profilePattern(
    new Pattern(() => {
      throw Error('broken');
    }),
    0.5,
  );
  expect(broken.windows.at(-1)?.end).toBe(32);
  expect(broken.errors).toBe(1280);
  expect(broken.firstError).toContain('broken');
});
