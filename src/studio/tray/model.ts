import { parse } from 'acorn';
import type * as JS from 'estree';
import { describeTarget } from '../../document/edit';
import type { Doc } from '../../document';
import type { SheetInput } from '../../contract';
import { makeCell } from '../../sheet/model';
import type { Cell, Row } from '../../sheet/model';

const names: Record<string, string> = {
  rhythm: 'Rhythm',
  note: 'Notes',
  n: 'Notes',
  freq: 'Frequency',
  s: 'Sound',
  lpf: 'Cutoff',
  cutoff: 'Cutoff',
  hpf: 'High pass',
  hcutoff: 'High pass',
  gain: 'Level',
  resonance: 'Resonance',
  lpq: 'Resonance',
  shape: 'Drive',
  room: 'Reverb',
  roomsize: 'Room size',
  size: 'Room size',
  pan: 'Pan',
  delay: 'Delay',
  delaytime: 'Delay time',
  delayfeedback: 'Delay feedback',
  attack: 'Attack',
  release: 'Release',
  decay: 'Decay',
  sustain: 'Sustain',
  speed: 'Speed',
  orbit: 'Room',
  fmi: 'FM amount',
  fm: 'FM amount',
};
export const plainName = (name: string) => names[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2');
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
/** Sheet owns the inventory. Add its explicit use-site targets instead of
 * silently discarding section-local settings and rewrites. */
export function trayItems(input: SheetInput, row: Row, sectionId?: string) {
  const { doc } = input;
  const answers: Partial<SheetInput['events']> = input.events;
  const settings = row.cells.filter((cell) => cell.kind !== 'unused' && cell.name !== 'rhythm');
  const rewrites = [...row.rewrites];
  const seen = new Set([...settings, ...rewrites].map((item) => item.nodeId));
  for (const use of row.useTargets) {
    if (seen.has(use.nodeId)) continue;
    const target = describeTarget(doc, use.nodeId);
    if (sectionId && target.section && target.section.id !== sectionId) continue;
    seen.add(use.nodeId);
    if (
      target.kind === 'rewrite' ||
      (target.kind === 'source' && !(target.node && 'value' in target.node))
    )
      rewrites.push({
        nodeId: use.nodeId,
        name: target.control,
        summary: use.text,
        source: target.kind === 'source',
      });
    else
      settings.push(
        makeCell(
          target.control,
          use.nodeId,
          answers[row.id]?.error ? [] : (answers[row.id]?.events ?? []),
          true,
          target.kind === 'setting-signal',
          row.status,
          input,
        ),
      );
  }
  return { settings, rewrites };
}
export function sparkline(cell: Cell): string {
  return cell.marks
    .map((mark, i) => `${i ? 'L' : 'M'}${String(mark.x)},${String(mark.y)}`)
    .join(' ');
}
