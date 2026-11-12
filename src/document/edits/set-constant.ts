import type { Doc } from '../types';
import { describeTarget, type Constant } from '../edit';
import { findWithPath, replaceAtPath, type Refusal } from './shared';
/** Pure constant edit. Refusals are values, never throws. */
export function setConstant(doc: Doc, nodeId: string, value: Constant): Doc | Refusal {
  const target = describeTarget(doc, nodeId);
  if (!target.editable) return { ok: false, reason: target.reason };
  if (
    typeof value !== typeof target.value ||
    (typeof value === 'number' && !Number.isFinite(value))
  )
    return { ok: false, reason: 'Use a finite value of the same type' };
  if (value === target.value) return doc;
  return replaceAtPath(doc, [...findWithPath(doc, nodeId)!.path, 'value', 'core', 'value'], value);
}
