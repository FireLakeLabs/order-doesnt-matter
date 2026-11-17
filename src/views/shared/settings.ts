import type { ViewNote } from '../types';

export interface SettingRange {
  min: number | undefined;
  max: number | undefined;
  values: ReadonlySet<unknown>;
}
/** Each present setting's finite numeric min/max and nonnumeric SameValueZero value set; mixed types retain both. */
export function settingRanges(notes: readonly ViewNote[]): Map<string, SettingRange> {
  const result = new Map<
    string,
    { min: number | undefined; max: number | undefined; values: Set<unknown> }
  >();
  for (const note of notes)
    for (const [key, value] of Object.entries(note.value)) {
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      let range = result.get(key);
      if (!range) result.set(key, (range = { min: undefined, max: undefined, values: new Set() }));
      if (typeof value === 'number') {
        range.min = Math.min(range.min ?? value, value);
        range.max = Math.max(range.max ?? value, value);
      } else range.values.add(value);
    }
  return result;
}
