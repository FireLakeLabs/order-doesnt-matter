import * as controls from '@strudel/core/controls.mjs';
import { Pattern } from '@strudel/core';
import { query } from './index';
// Pinned registry canary: aliases are identified by their actual output bag.
// Keep all imports of the control registry and prototype within the Strudel seam.
export const controlNames = new Map<string, string>();
for (const [name, fn] of Object.entries(controls)) {
  if (!controls.isControlName(name) || typeof fn !== 'function') continue;
  const pattern = (fn as unknown as (value: number) => Pattern)(0);
  const value = query(pattern, 0, 1)[0]?.value;
  if (value && typeof value === 'object') controlNames.set(name, Object.keys(value)[0]);
}
for (const name of Object.getOwnPropertyNames(Pattern.prototype))
  if (controls.isControlName(name) && !controlNames.has(name)) controlNames.set(name, name);
export const patternMethods = new Set(Object.getOwnPropertyNames(Pattern.prototype));
