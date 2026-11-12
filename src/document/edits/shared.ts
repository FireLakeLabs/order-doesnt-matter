import {
  instruments,
  sections,
  walk,
  type Pattern,
  type Doc,
  type DocumentNode,
  type Path,
} from '../index';
export interface Refusal {
  ok: false;
  reason: string;
}
export function findWithPath(doc: Doc, id: string): { node: DocumentNode; path: Path } | undefined {
  let found: { node: DocumentNode; path: Path } | undefined;
  walk(doc, (node, path) => {
    if (node.id === id) found = { node, path };
  });
  return found;
}
import { at, contentChanges, sameContent, refreshNotation } from '../content';
const statuses = new WeakMap<Doc, string[]>();
export function instrumentEditStatus(doc: Doc): string {
  const names = statuses.get(doc) ?? [];
  return names.length
    ? `${names.length === 1 ? 'One section keeps' : 'Sections keep'} ${names.length === 1 ? 'its' : 'their'} own version: ${names.join(', ')}.`
    : '';
}
/** Copies ancestors only; the replacement and every untouched branch keep identity. */
function replaceOnly(doc: Doc, path: Path, value: unknown): Doc {
  function replace(node: unknown, depth: number): unknown {
    if (depth === path.length) return value;
    const key = path[depth],
      old = node as Record<string | number, unknown>;
    const child = replace(old[key], depth + 1);
    if (child === old[key]) return node;
    const next = Array.isArray(node) ? [...node] : { ...old };
    (next as Record<string | number, unknown>)[key] = child;
    return next;
  }
  return replace(doc, 0) as Doc;
}
/** Apply a canonical row operation at the same relative content addresses in
 * every stored origin copy. Use-site edits have no canonical ancestor here. */
export function replaceAtPath(doc: Doc, path: Path, value: unknown): Doc {
  const next = replaceOnly(doc, path, value);
  if (next === doc) return doc;
  const copies: { pattern: Pattern; path: Path }[] = [];
  walk(doc, (node, p) => {
    if ('core' in node && (node as Pattern).origin)
      copies.push({ pattern: node as Pattern, path: p });
  });
  if (!copies.length) return next;
  const rows = instruments(doc);
  const owner = rows
    .map((r) => ({ row: r, found: findWithPath(doc, r.pattern.id)! }))
    .find(({ found }) => found.path.every((key, i) => path[i] === key));
  if (!owner) return next;
  const changes = contentChanges(owner.row.pattern, at(next, owner.found.path));
  let result = next;
  const kept = new Set<string>();
  const fresh = freshIds(next);
  for (const copy of copies.filter((c) => c.pattern.origin === owner.row.pattern.id)) {
    // Reuse the localized ids for surviving nodes; allocate only genuinely new ones.
    const ids = new Map<string, string>();
    walk(doc, (node, p) => {
      if (owner.found.path.every((key, i) => p[i] === key)) {
        const local = at(copy.pattern, p.slice(owner.found.path.length));
        if (local && typeof local === 'object' && 'id' in local) ids.set(node.id, String(local.id));
      }
    });
    function adopt(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(adopt);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          k === 'id' && typeof v === 'string' && ('tier' in value || 'pattern' in value)
            ? (ids.get(v) ?? fresh('copy'))
            : k === 'value' && 'kind' in value && ['literal', 'data'].includes(String(value.kind))
              ? structuredClone(v)
              : adopt(v),
        ]),
      );
    }
    for (const change of changes) {
      const own = at(copy.pattern, change.path);
      // A matching scalar inside a different call is not the same address.
      const compatible = change.path.every((_, depth) => {
        const a = at(owner.row.pattern, change.path.slice(0, depth));
        const b = at(copy.pattern, change.path.slice(0, depth));
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return true;
        for (const key of ['kind', 'name'] as const)
          if (
            key in a &&
            (a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]
          )
            return false;
        return true;
      });
      const agrees =
        compatible &&
        (change.order
          ? Array.isArray(own) &&
            own.length === change.order.length &&
            change.order.every(
              (from, to) => from === to || sameContent(own[to], (change.before as unknown[])[to]),
            )
          : change.splice
            ? Array.isArray(own) &&
              own.length === change.splice.total &&
              sameContent(
                own.slice(change.splice.index, change.splice.index + change.splice.length),
                change.before,
              )
            : sameContent(own, change.before));
      if (!agrees) {
        for (const section of sections(doc))
          if (
            owner.row.uses.some(
              (u) =>
                u.path.some((n) => n.id === section.id) &&
                u.path.some((n) => n.id === copy.pattern.id),
            )
          )
            kept.add(section.name);
        continue;
      }
      let replacement = adopt(change.after);
      if (change.order && Array.isArray(own)) replacement = change.order.map((i) => own[i]);
      else if (change.splice && Array.isArray(own)) {
        const items = [...own];
        items.splice(change.splice.index, change.splice.length, ...(replacement as unknown[]));
        replacement = items;
      }
      result = replaceOnly(result, [...copy.path, ...change.path], replacement);
    }
    // Only copied branches are new objects; never mutate an earlier snapshot.
    const updated = at(result, copy.path);
    if (updated !== copy.pattern) {
      const normalized = structuredClone(updated);
      refreshNotation(normalized);
      result = replaceOnly(result, copy.path, normalized);
    }
  }
  if (kept.size) statuses.set(result, [...kept]);
  return result;
}
export function replaceNode(doc: Doc, id: string, node: DocumentNode): Doc | Refusal {
  const found = findWithPath(doc, id);
  return found
    ? replaceAtPath(doc, found.path, node)
    : { ok: false, reason: 'Target no longer exists' };
}
/** One allocator per edit reserves every returned id, including newly allocated ids. */
export function freshIds(doc: Doc): (prefix?: string) => string {
  const used = new Set<string>();
  walk(doc, (n) => used.add(n.id));
  let serial = 0;
  return (prefix = 'n') => {
    let id: string;
    do {
      id = `${prefix}${++serial}`;
    } while (used.has(id));
    used.add(id);
    return id;
  };
}
