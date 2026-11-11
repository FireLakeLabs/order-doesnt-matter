import type { Arg, Core, Doc, Layer, Meta, Pattern, Step } from './types';
export type * from './types';
export type Path = readonly (string | number)[];
export const voices = (doc: Doc) => doc.body.filter((node) => node.kind === 'voice');
/** The last definition wins; selection does not evaluate references. */
export const shared = (doc: Doc, name: string) =>
  doc.body.filter((node) => node.kind === 'shared').findLast((node) => node.name === name)?.pattern;
export const tempo = (doc: Doc) => doc.body.filter((node) => node.kind === 'tempo').at(-1)?.cpm;
const unreachable = (node: never): never => {
  throw Error(`Unknown document variant: ${JSON.stringify(node)}`);
};

/** Preorder traversal; paths address nodes in the serialized document. */
export function walk(doc: Doc, visit: (node: Meta, path: Path) => void): void {
  function args(items: Arg[], path: Path) {
    items.forEach((arg, i) => {
      const p = [...path, i];
      switch (arg.kind) {
        case 'pattern':
          pattern(arg.pattern, [...p, 'pattern']);
          break;
        case 'callback':
          pattern(arg.body, [...p, 'body']);
          break;
        case 'literal':
        case 'opaque':
          break;
        default:
          unreachable(arg);
      }
    });
  }
  function step(s: Step): void {
    switch (s.kind) {
      case 'sub':
      case 'alternate':
      case 'together':
      case 'choose':
        s.steps.forEach(step);
        break;
      case 'polymeter':
        s.steps.forEach(step);
        if (s.per) step(s.per);
        break;
      case 'euclid':
        step(s.step);
        step(s.pulses);
        step(s.steps);
        if (s.rotation) step(s.rotation);
        break;
      case 'value':
      case 'rest':
      case 'other':
        break;
      default:
        unreachable(s);
    }
  }
  function core(c: Core, path: Path) {
    switch (c.kind) {
      case 'sequence':
        c.steps.forEach(step);
        break;
      case 'group':
        c.parts.forEach((part, i) => pattern(part.pattern, [...path, 'parts', i, 'pattern']));
        break;
      case 'signal':
        if (c.args) args(c.args, [...path, 'args']);
        break;
      case 'generator':
        args(c.args, [...path, 'args']);
        break;
      case 'constant':
      case 'data':
      case 'ref':
      case 'hole':
      case 'opaque':
        break;
      default:
        unreachable(c);
    }
  }
  function layer(l: Layer, path: Path) {
    visit(l, path);
    switch (l.kind) {
      case 'settings':
        l.settings.forEach((setting, i) => {
          const p = [...path, 'settings', i];
          visit(setting, p);
          pattern(setting.value, [...p, 'value']);
        });
        break;
      case 'rewrite':
        args(l.args, [...path, 'args']);
        break;
      case 'opaque':
        break;
      default:
        unreachable(l);
    }
  }
  function pattern(p: Pattern, path: Path) {
    visit(p, path);
    core(p.core, [...path, 'core']);
    p.layers.forEach((l, i) => layer(l, [...path, 'layers', i]));
  }
  doc.body.forEach((node, i) => {
    const path: Path = ['body', i];
    visit(node, path);
    switch (node.kind) {
      case 'shared':
      case 'voice':
        pattern(node.pattern, [...path, 'pattern']);
        break;
      case 'transform':
        args(node.args, [...path, 'args']);
        break;
      case 'setup':
      case 'tempo':
        break;
      default:
        unreachable(node);
    }
  });
}
export function findById(doc: Doc, id: string): Meta | undefined {
  let found: Meta | undefined;
  walk(doc, (node) => {
    if (node.id === id && !found) found = node;
  });
  return found;
}
export function checkDoc(doc: Doc): string[] {
  const problems: string[] = [],
    ids = new Set<string>();
  const names = new Set(doc.body.filter((n) => n.kind === 'shared').map((n) => n.name));
  if (doc.version !== 1) problems.push(`Unsupported document version: ${doc.version}`);
  walk(doc, (node) => {
    if (ids.has(node.id)) problems.push(`Duplicate id: ${node.id}`);
    ids.add(node.id);
    if ('core' in node) {
      const core = (node as Pattern).core;
      if (core.kind === 'ref' && !names.has(core.name))
        problems.push(`Missing shared name: ${core.name}`);
    }
  });
  return problems;
}
export { instruments, sections } from './instruments';
export type { Instrument, InstrumentUse, SongSection } from './instruments';
