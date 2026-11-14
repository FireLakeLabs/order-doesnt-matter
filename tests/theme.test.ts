import { describe, expect, it } from 'vitest';
import { readTheme } from '../src/app/theme';

describe('optional theme preference', () => {
  it('accepts only the three palettes, using its own key', () => {
    for (const value of ['paper', 'fern', 'night', '', 'PAPER', '{}', 'null', null]) {
      const keys: string[] = [];
      expect(readTheme({ getItem: (key) => (keys.push(key), value) })).toBe(
        ['fern', 'night'].includes(value ?? '') ? value : 'paper',
      );
      expect(keys).toEqual(['odm:theme']);
    }
  });
  it('defaults to Paper when storage access throws or is absent', () => {
    expect(
      readTheme({
        getItem: () => {
          throw Error('Denied');
        },
      }),
    ).toBe('paper');
    expect(readTheme()).toBe('paper');
  });
});
