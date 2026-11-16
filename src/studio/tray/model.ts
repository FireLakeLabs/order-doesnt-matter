import { parse } from 'acorn';
import type * as JS from 'estree';
import type { Doc } from '../../document';
import type { Cell } from '../../sheet/model';

export { plainName } from '../view-instruments';
export interface CustomWord {
  name: string;
  nodeId: string;
  source: string;
}
/** Inspect setup syntax, never execute it. A register call can be nested in a
 * declaration; all words from the piece remain available, even on a resting row. */
export function customWords(doc: Doc): CustomWord[] {
  const words: CustomWord[] = [];
  for (const entry of doc.body) {
    if (entry.kind !== 'setup') continue;
    let program: JS.Program;
    try {
      program = parse(entry.code, {
        ecmaVersion: 'latest',
        allowAwaitOutsideFunction: true,
      }) as unknown as JS.Program;
    } catch {
      continue;
    }
    const visit = (node: JS.Node) => {
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'register'
      ) {
        const arg = node.arguments.at(0);
        if (arg?.type === 'Literal' && typeof arg.value === 'string')
          words.push({ name: arg.value, nodeId: entry.id, source: entry.code });
      }
      if (node.type === 'FunctionDeclaration')
        words.push({ name: node.id.name, nodeId: entry.id, source: entry.code });
      if (
        node.type === 'VariableDeclarator' &&
        node.id.type === 'Identifier' &&
        node.init &&
        ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init.type)
      )
        words.push({ name: node.id.name, nodeId: entry.id, source: entry.code });
      for (const child of Object.values(node)) {
        if (Array.isArray(child))
          child.forEach((value: unknown) => {
            if (value && typeof value === 'object' && 'type' in value) visit(value as JS.Node);
          });
        else if (child && typeof child === 'object' && 'type' in child) visit(child as JS.Node);
      }
    };
    visit(program);
  }
  return [...new Map(words.map((word) => [word.name, word])).values()];
}
export function sparkline(cell: Cell): string {
  return cell.marks
    .map((mark, i) => `${i ? 'L' : 'M'}${String(mark.x)},${String(mark.y)}`)
    .join(' ');
}
