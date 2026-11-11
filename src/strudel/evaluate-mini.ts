import { parse } from '@strudel/mini/krill-parser.js';
// Depends on the pinned PEG AST's type_, source_, arguments_, options_ and
// location_ fields. Typed mini tests are canaries for each inspected variant.
export function miniAst(notation: string): unknown {
  return parse(JSON.stringify(notation));
}
