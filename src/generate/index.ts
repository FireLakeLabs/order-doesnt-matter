import type { Generate } from '../contract';
import type { Arg, JsonValue, Pattern } from '../document';
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
function argument(arg: Arg, hole?: string): string {
  switch (arg.kind) {
    case 'literal':
      return literal(arg.value);
    case 'opaque':
      return arg.code;
    case 'pattern':
      return generatePattern(arg.pattern, hole);
    case 'callback': {
      const parameter = arg.parameter ?? 'p';
      return `${parameter} => ${generatePattern(arg.body, parameter)}`;
    }
  }
}
export function generatePattern(pattern: Pattern, hole?: string): string {
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
      code = c.args ? `${c.shape}(${c.args.map((a) => argument(a, hole)).join(', ')})` : c.shape;
      break;
    case 'ref':
      code = c.name;
      break;
    case 'hole':
      code = hole ?? 'p';
      break;
    case 'generator':
      code =
        c.name === 'silence' && !c.args.length
          ? 'silence'
          : `${c.name}(${c.args.map((a) => argument(a, hole)).join(', ')})`;
      break;
    case 'group':
      code = `${c.how}(${c.parts
        .map((part) => {
          let p = generatePattern(part.pattern, hole);
          if (part.muted) p = `(${p}).filterWhen(()=>false)`;
          if (part.label !== undefined || part.muted !== undefined)
            p = `(${annotation('part', { label: part.label, muted: part.muted })} ${p})`;
          return c.how === 'arrange' ? `[${part.cycles ?? 1}, ${p}]` : p;
        })
        .join(', ')})`;
      break;
  }
  if (pattern.layers.length && ['constant', 'data'].includes(c.kind)) code = `pure(${code})`;
  for (const layer of pattern.layers) {
    if (layer.kind === 'settings')
      for (const setting of [...layer.settings].sort((a, b) => a.name.localeCompare(b.name)))
        code += `.${setting.name}(${generatePattern(setting.value, hole)})`;
    else if (layer.kind === 'rewrite')
      code += `.${layer.name}(${layer.args.map((a) => argument(a, hole)).join(', ')})`;
    else code += layer.code;
  }
  if (pattern.muted) code += '.filterWhen(()=>false)';
  if (pattern.label !== undefined || pattern.comment !== undefined || pattern.muted !== undefined)
    code = `(${annotation('pattern', { label: pattern.label, comment: pattern.comment, muted: pattern.muted })} ${code})`;
  return code;
}
export const generate: Generate = (doc, options = {}) => {
  if (options.only && !doc.body.some((n) => n.kind === 'voice' && n.id === options.only))
    throw Error(`Unknown instrument: ${options.only}`);
  return doc.body
    .flatMap((node) => {
      switch (node.kind) {
        case 'setup':
          return [node.code];
        case 'tempo':
          return [`setcpm(${node.cpm});`];
        case 'shared':
          return [`const ${node.name} = ${generatePattern(node.pattern)};`];
        case 'transform':
          return [`all(${node.args.map((a) => argument(a)).join(', ')});`];
        case 'voice':
          if (options.only && options.only !== node.id) return [];
          return [
            `${node.muted ? '_$' : '$'}: ${annotation('voice', { name: node.name, nameSource: node.nameSource, muted: node.muted })} ${generatePattern(node.pattern)};`,
          ];
      }
    })
    .join('\n');
};
