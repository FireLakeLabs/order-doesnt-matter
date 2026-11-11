import { Pattern } from '@strudel/core';
import type { Hap, State } from './index';

// Depends on Cyclist querying queryArc (which swallows exceptions): guard direct query first.
export function guarded(
  pattern: Pattern,
  failed: (error: unknown) => void,
  tag: (hap: Hap) => void,
): Pattern {
  return new Pattern((state: State) => {
    try {
      const haps = pattern.query(state);
      haps.forEach(tag);
      return haps;
    } catch (error) {
      failed(error);
      return [];
    }
  });
}
