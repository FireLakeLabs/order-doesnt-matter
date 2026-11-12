import { walk, type Doc, type Pattern, type Path, type RewriteLayer } from '../index';
/** Rewrites are owned by a pattern, including patterns inside callbacks. */
export function rewriteOwner(doc: Doc, id: string) {
  let found: { pattern: Pattern; path: Path; index: number; layer: RewriteLayer } | undefined;
  walk(doc, (node, path) => {
    if (!('layers' in node)) return;
    const pattern = node as Pattern;
    const index = pattern.layers.findIndex((l) => l.id === id && l.kind === 'rewrite');
    if (index >= 0) found = { pattern, path, index, layer: pattern.layers[index] as RewriteLayer };
  });
  return found;
}
