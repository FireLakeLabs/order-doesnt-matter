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

/** Pinned arities/roles: tests/callback-rewrite.test.ts queries each separately. */
export function callbackRole(layer: RewriteLayer, index: number): string | undefined {
  const roles: Record<string, string[]> = {
    every: ['', 'Periodic change'],
    off: ['', 'Shifted copy'],
    jux: ['Right channel'],
    sometimes: ['Time-addressed change'],
    when: ['', 'Conditional change'],
    superimpose: ['Added copy'],
  };
  if (layer.name === 'layer') return `Branch ${index + 1}`;
  const labels = roles[layer.name];
  return labels?.length === layer.args.length ? labels[index] || undefined : undefined;
}
export function callbackBranches(doc: Doc) {
  const branches: {
    parent: RewriteLayer;
    index: number;
    body: Pattern;
    parameter: string;
    role: string;
    path: Path;
    supported: boolean;
  }[] = [];
  walk(doc, (node, path) => {
    if (!('kind' in node) || node.kind !== 'rewrite') return;
    const parent = node as RewriteLayer;
    parent.args.forEach((arg, index) => {
      if (arg.kind !== 'callback') return;
      const role = callbackRole(parent, index);
      branches.push({
        parent,
        index,
        body: arg.body,
        parameter: arg.parameter ?? 'p',
        role: role ?? `Argument ${index + 1}`,
        path: [...path, 'args', index, 'body'],
        supported: !!role && arg.body.core.kind === 'hole',
      });
    });
  });
  return branches;
}
export function callbackTrail(doc: Doc, id: string) {
  let target: Path = [];
  walk(doc, (node, path) => {
    if (node.id === id) target = path;
  });
  return callbackBranches(doc).filter((branch) =>
    branch.path.every((part, index) => target[index] === part),
  );
}
