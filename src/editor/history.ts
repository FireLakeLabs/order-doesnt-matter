import type { Doc } from '../document';
export interface History {
  present: Doc;
  past: Doc[];
  future: Doc[];
  depth: number;
  group?: string;
}
export const history = (present: Doc, depth = 50): History => ({
  present,
  past: [],
  future: [],
  depth: Math.max(1, Math.floor(depth)),
});
/** A gesture token is unique per drag. Same target alone never coalesces edits. */
export function push(h: History, doc: Doc, target: string, gesture?: string): History {
  if (doc === h.present) return h;
  const group = gesture ? JSON.stringify([target, gesture]) : undefined;
  return {
    ...h,
    present: doc,
    past: group && group === h.group ? h.past : [...h.past, h.present].slice(-h.depth),
    future: [],
    group,
  };
}
export function undo(h: History): History {
  return h.past.length
    ? {
        ...h,
        present: h.past.at(-1)!,
        past: h.past.slice(0, -1),
        future: [h.present, ...h.future],
        group: undefined,
      }
    : h;
}
export function redo(h: History): History {
  return h.future.length
    ? {
        ...h,
        present: h.future[0],
        past: [...h.past, h.present].slice(-h.depth),
        future: h.future.slice(1),
        group: undefined,
      }
    : h;
}
