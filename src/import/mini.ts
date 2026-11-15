import type { MiniExpression, MiniMark, Step } from '../document';
import { miniAst } from '../strudel/evaluate-mini';

interface Node {
  type_: string;
  source_?: string | Node | Node[];
  arguments_?: { alignment?: string; _steps?: boolean; stepsPerCycle?: Node };
  options_?: { weight?: number; reps?: number; ops?: Operation[] };
  location_?: { start: { offset: number }; end: { offset: number } };
}
interface Operation {
  type_: string;
  arguments_: { amount?: number | null; pulse?: Node; step?: Node; rotation?: Node };
}
function node(value: unknown): Node {
  if (!value || typeof value !== 'object' || !('type_' in value) || typeof value.type_ !== 'string')
    throw Error('Strudel mini AST changed: expected a typed node');
  return value as Node;
}
/** Split only outer punctuation; nested argument patterns keep their own marks.
 * The pinned PEG aggregates !/@, so their written occurrences come from source.
 * Tail/range/underscore and Euclid after outer marks remain opaque. */
function ordered(text: string): MiniExpression | undefined {
  const cuts: number[] = [];
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('[<{('.includes(c)) stack.push(c);
    else if (']>})'.includes(c)) stack.pop();
    else if (!stack.length && '!*/@?'.includes(c)) cuts.push(i);
  }
  if (!cuts.length) return;
  const symbols = cuts.map((i) => text[i]).join('');
  // Keep the existing compact forms and serialized v2 documents unchanged.
  if (/^!?@?\??$/.test(symbols)) return;
  const base = parseSteps(text.slice(0, cuts[0]));
  if (base.length !== 1 || base[0].kind === 'other') return;
  const marks: MiniMark[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const symbol = text[cuts[i]],
      arg = text.slice(cuts[i] + 1, cuts[i + 1]).trim();
    if (symbol === '*' || symbol === '/') {
      const amount = parseSteps(arg);
      if (amount.length !== 1 || amount[0].kind === 'other') return;
      // Rates are slices, not slice_with_ops (e.g. *2(3,8) acts on the note).
      if (!/^(?:-?[\d.]+|\[.*\]|<.*>|\{.*\})$/s.test(arg)) return;
      marks.push({ name: symbol === '*' ? 'faster' : 'slower', amount: amount[0] });
    } else {
      if (arg && (!/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(arg) || !Number.isFinite(Number(arg))))
        return;
      marks.push({
        name: symbol === '!' ? 'repeat' : symbol === '@' ? 'weight' : 'chance',
        ...(arg ? { amount: Number(arg) } : {}),
      });
    }
  }
  return { step: base[0], marks };
}
export function printExpression(expression: MiniExpression): string {
  const symbols = { faster: '*', slower: '/', repeat: '!', weight: '@', chance: '?' };
  return (
    printSteps([expression.step]) +
    expression.marks
      .map(
        (m) =>
          symbols[m.name] +
          (typeof m.amount === 'object' ? printSteps([m.amount]) : (m.amount ?? '')),
      )
      .join('')
  );
}
export function parseSteps(notation: string): Step[] {
  const root = node(miniAst(notation));
  const quoted = JSON.stringify(notation);
  const raw = (n: Node): string =>
    n.location_ ? quoted.slice(n.location_.start.offset, n.location_.end.offset).trim() : notation;
  const other = (n: Node): Step => {
    if (!n.location_) throw Error('Unmodelled mini alignment');
    return { kind: 'other', notation: raw(n) };
  };
  function convert(n: Node): Step {
    if (n.type_ === 'atom' && typeof n.source_ === 'string')
      return n.source_ === '~' ? { kind: 'rest' } : { kind: 'value', value: n.source_ };
    if (
      n.type_ === 'element' &&
      n.source_ &&
      !Array.isArray(n.source_) &&
      typeof n.source_ === 'object'
    ) {
      try {
        const expression = ordered(raw(n));
        if (expression) return { kind: 'other', notation: printExpression(expression), expression };
      } catch {
        /* Unknown outer forms retain the complete original chunk. */
      }
      let child: Step;
      try {
        child = convert(n.source_);
      } catch {
        return other(n);
      }
      if (child.kind === 'other') return other(n);
      const { weight = 1, reps = 1, ops = [] } = n.options_ ?? {};
      const euclid = ops.find((op) => op.type_ === 'bjorklund');
      if (
        euclid &&
        ops.length === 1 &&
        weight === 1 &&
        reps === 1 &&
        euclid.arguments_.pulse &&
        euclid.arguments_.step
      ) {
        child = {
          kind: 'euclid',
          step: child,
          pulses: convert(euclid.arguments_.pulse),
          steps: convert(euclid.arguments_.step),
          ...(euclid.arguments_.rotation ? { rotation: convert(euclid.arguments_.rotation) } : {}),
        };
        return child;
      }
      if (
        ops.some((op) => !['replicate', 'degradeBy'].includes(op.type_)) ||
        ops.filter((op) => op.type_ === 'degradeBy').length > 1
      )
        return other(n);
      if (weight === 1 && reps === 1 && !ops.length) return child;
      if (!['value', 'rest', 'sub'].includes(child.kind)) return other(n);
      if (child.kind === 'value' || child.kind === 'rest' || child.kind === 'sub') {
        if (weight !== reps) child.weight = weight;
        if (reps !== 1) {
          if (child.kind !== 'value') return other(n);
          child.repeat = reps;
        }
        const chance = ops.find((op) => op.type_ === 'degradeBy');
        if (chance) {
          if (child.kind !== 'value') return other(n);
          child.chance = chance.arguments_.amount ?? 0.5;
        }
      }
      // A degradation before repetition uses a different random seed structure.
      if (
        ops.findIndex((op) => op.type_ === 'degradeBy') <
          ops.findIndex((op) => op.type_ === 'replicate') &&
        ops.some((op) => op.type_ === 'degradeBy')
      )
        return other(n);
      return child;
    }
    if (n.type_ !== 'pattern' || !Array.isArray(n.source_) || n.arguments_?._steps) return other(n);
    const children = n.source_;
    const single = (c: Node) =>
      c.type_ === 'pattern' &&
      c.arguments_?.alignment === 'fastcat' &&
      Array.isArray(c.source_) &&
      c.source_.length === 1
        ? convert(c.source_[0])
        : convert(c);
    switch (n.arguments_?.alignment) {
      case 'fastcat':
        return { kind: 'sub', steps: children.map(convert) };
      case 'stack':
        return { kind: 'together', steps: children.map(single) };
      case 'rand':
        return { kind: 'choose', steps: children.map(single) };
      case 'polymeter':
        return {
          kind: 'polymeter',
          steps: children.map(convert),
          ...(n.arguments_.stepsPerCycle ? { per: convert(n.arguments_.stepsPerCycle) } : {}),
        };
      case 'polymeter_slowcat':
        // Multiple lanes inside <> retain their original syntax until the
        // document has an explicit representation of that alignment.
        if (children.length !== 1 || !Array.isArray(children[0].source_)) return other(n);
        return { kind: 'alternate', steps: children[0].source_.map(convert) };
      default:
        return other(n);
    }
  }
  try {
    if (
      root.type_ === 'pattern' &&
      root.arguments_?.alignment === 'fastcat' &&
      !root.arguments_._steps &&
      Array.isArray(root.source_)
    )
      return root.source_.map(convert);
    return [convert(root)];
  } catch {
    return [{ kind: 'other', notation }];
  }
}
export function printSteps(steps: Step[]): string {
  return steps.map(printStep).join(' ');
}
function printStep(step: Step): string {
  let text: string;
  switch (step.kind) {
    case 'other':
      return step.expression ? printExpression(step.expression) : step.notation;
    case 'value':
      text = step.value;
      break;
    case 'rest':
      text = '~';
      break;
    case 'sub':
      text = `[${printSteps(step.steps)}]`;
      break;
    case 'alternate':
      return `<${printSteps(step.steps)}>`;
    case 'together':
      return `[${step.steps.map(printStep).join(',')}]`;
    case 'choose':
      return `[${step.steps.map(printStep).join('|')}]`;
    case 'polymeter':
      return `{${step.steps.map((s) => (s.kind === 'sub' ? printSteps(s.steps) : printStep(s))).join(',')}}${step.per ? `%${printStep(step.per)}` : ''}`;
    case 'euclid':
      return `${printStep(step.step)}(${printStep(step.pulses)},${printStep(step.steps)}${step.rotation ? `,${printStep(step.rotation)}` : ''})`;
  }
  // The PEG gives ! a weight as well. Apply a differing explicit weight after it.
  if (step.kind === 'value' && step.repeat !== undefined) text += `!${step.repeat}`;
  if (step.weight !== undefined)
    text += `@${step.weight - (step.kind === 'value' ? (step.repeat ?? 1) : 1) + 1}`;
  if (step.kind === 'value' && step.chance !== undefined)
    text += step.chance === 0.5 ? '?' : `?${step.chance}`;
  return text;
}
