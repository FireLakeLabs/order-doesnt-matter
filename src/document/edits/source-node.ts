import { instruments, type Doc } from '../index';
import type { EventResult } from '../../contract';
import { generate } from '../../generate';
import { installSource, sameOnsets } from './source-shared';
import { replaceOpaque } from './source-opaque';
/** Candidate promotion only: callers must prove event equality with the opaque edit. */
export const replaceFromSource = (doc: Doc, id: string, code: string) =>
  installSource(doc, id, code, true);
/** One final document means one Apply and one undo step, including promotion. */
export async function prepareSource(
  before: Doc,
  id: string,
  text: string,
  ask?: (doc: Doc, id: string) => Promise<EventResult>,
) {
  const raw = replaceOpaque(before, id, text);
  if ('ok' in raw) return raw;
  const candidate = replaceFromSource(before, id, text),
    rows = instruments(raw);
  let equal =
    !!ask &&
    rows.length > 0 &&
    !('ok' in candidate) &&
    JSON.stringify(rows.map((r) => r.id)) ===
      JSON.stringify(instruments(candidate).map((r) => r.id));
  let broken = '';
  try {
    const oldIds = new Set(instruments(before).map((r) => r.id));
    if (ask)
      for (const row of rows) {
        if (
          oldIds.has(row.id) &&
          generate(before, { only: row.id }) === generate(raw, { only: row.id }) &&
          !('ok' in candidate) &&
          generate(raw, { only: row.id }) === generate(candidate, { only: row.id })
        )
          continue;
        const a = await ask(raw, row.id);
        if (a.error) {
          broken = a.error.message;
          equal = false;
          break;
        }
        if (equal && !('ok' in candidate)) equal = sameOnsets(a, await ask(candidate, row.id));
      }
  } catch (e) {
    broken = String(e instanceof Error ? e.message : e);
    equal = false;
  }
  return { doc: equal && !('ok' in candidate) ? candidate : raw, broken, promoted: equal };
}
