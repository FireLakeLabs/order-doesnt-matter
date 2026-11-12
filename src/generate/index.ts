import type { Generate } from '../contract';
import {
  instruments,
  shared,
  walk,
  type Arg,
  type Doc,
  type JsonValue,
  type Pattern,
} from '../document';
import { printSteps } from '../import/mini';

function literal(value: JsonValue): string {
  if (typeof value === 'string')
    return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')}'`;
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([k, v]) => `${literal(k)}: ${literal(v)}`)
      .join(', ')}}`;
  return JSON.stringify(value);
}
function annotation(tag: string, value: object): string {
  return `/*@odm-${tag} ${JSON.stringify(value).replaceAll('*/', '*\\/')}*/`;
}
function argument(arg: Arg, hole?: string, serialization?: Serialization): string {
  switch (arg.kind) {
    case 'literal':
      return literal(arg.value);
    case 'opaque':
      return arg.code;
    case 'pattern':
      return generatePattern(arg.pattern, hole, undefined, serialization);
    case 'callback': {
      const parameter = arg.parameter ?? 'p';
      return `${parameter} => ${generatePattern(arg.body, parameter, undefined, serialization)}`;
    }
  }
}
interface Serialization {
  identities: Set<string>;
  mutedOrigins: Set<string>;
}
interface Isolation {
  doc: Doc;
  selected: string;
  leaves: Set<string>;
  seen: Set<string>;
}
export function generatePattern(
  pattern: Pattern,
  hole?: string,
  isolation?: Isolation,
  serialization?: Serialization,
): string {
  const boundary = isolation?.leaves.has(pattern.origin ?? pattern.id);
  const silenced = boundary && (pattern.origin ?? pattern.id) !== isolation?.selected;
  // An explicit instrument may itself be a group. Its descendants belong to
  // that row, even when they also have unused definitions in the inventory.
  if (boundary) isolation = undefined;
  if (isolation) isolation = { ...isolation, seen: new Set(isolation.seen).add(pattern.id) };
  const c = pattern.core;
  let code: string;
  switch (c.kind) {
    case 'opaque':
      code = `(${c.code})`;
      break;
    case 'constant':
    case 'data':
      code = literal(c.value);
      break;
    case 'sequence':
      code = JSON.stringify(printSteps(c.steps));
      break;
    case 'signal':
      code = c.args
        ? `${c.shape}(${c.args.map((a) => argument(a, hole, serialization)).join(', ')})`
        : c.shape;
      break;
    case 'ref': {
      const target = isolation && shared(isolation.doc, c.name);
      code =
        target && !isolation!.seen.has(target.id)
          ? `(${generatePattern(target, hole, isolation, serialization)})`
          : c.name;
      break;
    }
    case 'hole':
      code = hole ?? 'p';
      break;
    case 'generator':
      code =
        c.name === 'silence' && !c.args.length
          ? 'silence'
          : `${c.name}(${c.args.map((a) => argument(a, hole, serialization)).join(', ')})`;
      break;
    case 'group':
      code = `${c.how}(${c.parts
        .map((part) => {
          let p = generatePattern(part.pattern, hole, isolation, serialization);
          if (part.muted) p = `(${p}).filterWhen(()=>false)`;
          if (
            part.label !== undefined ||
            part.labelSource !== undefined ||
            part.muted !== undefined
          )
            p = `(${annotation('part', { label: part.label, labelSource: part.labelSource, muted: part.muted })} ${p})`;
          return c.how === 'arrange' ? `[${part.cycles ?? 1}, ${p}]` : p;
        })
        .join(', ')})`;
      break;
  }
  if (pattern.layers.length && ['constant', 'data'].includes(c.kind)) code = `pure(${code})`;
  for (const layer of pattern.layers) {
    if (layer.kind === 'settings')
      for (const setting of [...layer.settings].sort((a, b) => a.name.localeCompare(b.name)))
        code += `.${setting.name}(${generatePattern(setting.value, hole, undefined, serialization)})`;
    else if (layer.kind === 'rewrite')
      code += `.${layer.name}(${layer.args.map((a) => argument(a, hole, serialization)).join(', ')})`;
    else code += layer.code;
  }
  if (silenced) code = `(${code}).filterWhen(()=>false)`;
  const originMuted = !!pattern.origin && !!serialization?.mutedOrigins.has(pattern.origin);
  if (pattern.muted || originMuted) code += '.filterWhen(()=>false)';
  if (
    pattern.label !== undefined ||
    pattern.comment !== undefined ||
    pattern.muted !== undefined ||
    pattern.origin !== undefined ||
    serialization?.identities.has(pattern.id)
  )
    code = `(${annotation('pattern', { label: pattern.label, comment: pattern.comment, muted: pattern.muted, originMuted: originMuted || undefined, origin: pattern.origin, identity: serialization?.identities.has(pattern.id) ? pattern.id : undefined })} ${code})`;
  return code;
}
export const generate: Generate = (doc, options = {}) => {
  const identities = new Set<string>();
  walk(doc, (n) => {
    if ('core' in n && (n as Pattern).origin) identities.add((n as Pattern).origin!);
  });
  const serialization: Serialization = {
    identities,
    mutedOrigins: new Set(
      instruments(doc)
        .filter((r) => r.pattern.muted)
        .map((r) => r.pattern.id),
    ),
  };
  const voiceOnly = doc.body.some((n) => n.kind === 'voice' && n.id === options.only);
  const rows = options.only && !voiceOnly ? instruments(doc) : [];
  const selected = rows.find((row) => row.id === options.only);
  if (options.only && !voiceOnly && !selected) throw Error(`Unknown instrument: ${options.only}`);
  const isolation = selected
    ? {
        doc,
        selected: selected.pattern.id,
        leaves: new Set(rows.map((row) => row.pattern.id)),
        seen: new Set<string>(),
      }
    : undefined;
  return doc.body
    .flatMap((node) => {
      switch (node.kind) {
        case 'setup':
          return [node.code];
        case 'tempo':
          return [`setcpm(${node.cpm});`];
        case 'shared':
          return [
            `${annotation('shared', { nameSource: node.nameSource, purpose: node.purpose })} const ${node.name} = ${generatePattern(node.pattern, undefined, undefined, serialization)};`,
          ];
        case 'transform':
          return [`all(${node.args.map((a) => argument(a)).join(', ')});`];
        case 'voice':
          if (voiceOnly && options.only !== node.id) return [];
          return [
            `${node.muted ? '_$' : '$'}: ${annotation('voice', { name: node.name, nameSource: node.nameSource, muted: node.muted })} ${generatePattern(node.pattern, undefined, isolation, serialization)};`,
          ];
      }
    })
    .join('\n');
};
