import { walk, type Doc, type Meta, type Path } from '../index';
export interface Refusal {
  ok: false;
  reason: string;
}
export function findWithPath(doc: Doc, id: string): { node: Meta; path: Path } | undefined {
  let found: { node: Meta; path: Path } | undefined;
  walk(doc, (node, path) => {
    if (node.id === id) found = { node, path };
  });
  return found;
}
/** Copies ancestors only; the replacement and every untouched branch keep identity. */
export function replaceAtPath(doc: Doc, path: Path, value: unknown): Doc {
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
export function replaceNode(doc: Doc, id: string, node: Meta): Doc | Refusal {
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
