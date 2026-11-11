import { parse, type Comment } from 'acorn';
import type * as JS from 'estree';
import type { ImportResult, ImportStrudel, ImportWarning } from '../contract';
import type { Arg, Doc, GroupPart, JsonValue, Meta, Pattern, Role, Tier } from '../document';
import { walk } from '../document';
import { parseSteps, printSteps } from './mini';
import {
  canonicalName,
  controlNames,
  groups,
  patternMethods,
  rewrites,
  signals,
  understoodControls,
} from './registry';

const outputs = new Set(
  'log scope pianoroll punchcard spiral spectrum osc midi midin out output draw analyze onTrigger'.split(
    ' ',
  ),
);
const setupCalls = new Set('samples hush register setcpm setCpm setcps setbpm'.split(' '));
function span(node: JS.Node): { start: number; end: number } {
  const n = node as JS.Node & { start: number; end: number };
  return { start: n.start, end: n.end };
}
/** Bounded arithmetic and JSON folding only. Never execute imported JavaScript. */
function literal(node: JS.Node): { value: JsonValue } | undefined {
  if (
    node.type === 'Literal' &&
    (node.value === null || ['number', 'string', 'boolean'].includes(typeof node.value))
  )
    return { value: node.value as JsonValue };
  if (node.type === 'UnaryExpression' && ['+', '-'].includes(node.operator)) {
    const value = literal(node.argument)?.value;
    if (typeof value === 'number') return { value: node.operator === '-' ? -value : value };
  }
  if (node.type === 'BinaryExpression') {
    const a = literal(node.left)?.value,
      b = literal(node.right)?.value;
    if (typeof a !== 'number' || typeof b !== 'number') return;
    const value =
      node.operator === '+'
        ? a + b
        : node.operator === '-'
          ? a - b
          : node.operator === '*'
            ? a * b
            : node.operator === '/'
              ? a / b
              : NaN;
    if (Number.isFinite(value)) return { value };
  }
  const nested = (n: JS.Node) =>
    !(n.type === 'Literal' && typeof n.value === 'string' && n.raw?.startsWith('"'))
      ? literal(n)
      : undefined;
  if (node.type === 'ArrayExpression') {
    const values: JsonValue[] = [];
    for (const el of node.elements) {
      const item = el && nested(el);
      if (!item) return;
      values.push(item.value);
    }
    return { value: values };
  }
  if (node.type === 'ObjectExpression') {
    const value: Record<string, JsonValue> = {};
    for (const p of node.properties) {
      if (p.type !== 'Property' || p.computed || p.method || p.shorthand || p.kind !== 'init')
        return;
      const key =
        p.key.type === 'Identifier'
          ? p.key.name
          : p.key.type === 'Literal'
            ? String(p.key.value)
            : undefined;
      const item = nested(p.value);
      if (key === undefined || key === '__proto__' || !item) return;
      value[key] = item.value;
    }
    return { value };
  }
}
function root(node: JS.Node): JS.Node {
  return node.type === 'CallExpression' &&
    !node.optional &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.optional &&
    !node.callee.computed
    ? root(node.callee.object)
    : node;
}
export const importStrudel: ImportStrudel = (source): ImportResult => {
  const comments: Comment[] = [];
  // Syntax errors are the one allowed exception in ImportStrudel's contract.
  const ast = parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowAwaitOutsideFunction: true,
    onComment: comments,
  }) as unknown as JS.Program;
  let serial = 0;
  const doc: Doc = { version: 1, body: [] };
  const warnings: ImportWarning[] = [];
  const meta = (node: JS.Node, tier: Tier, role?: Role): Meta => ({
    id: `n${++serial}`,
    tier,
    ...(role ? { role } : {}),
    span: span(node),
  });
  const text = (node: JS.Node) => source.slice(span(node).start, span(node).end);
  const warning = (node: JS.Node, message: string, nodeId?: string) =>
    warnings.push({ message, span: span(node), ...(nodeId ? { nodeId } : {}) });
  function setup(node: JS.Node, reason: string, code = text(node)) {
    const m = meta(node, 3, 'setup');
    doc.body.push({ ...m, kind: 'setup', code });
    warning(node, reason, m.id);
  }
  const unsafe = ast.body.some(
    (n) =>
      ![
        'ExpressionStatement',
        'VariableDeclaration',
        'LabeledStatement',
        'EmptyStatement',
      ].includes(n.type) ||
      (n.type === 'VariableDeclaration' && n.kind !== 'const') ||
      (n.type === 'ExpressionStatement' &&
        ['AssignmentExpression', 'UpdateExpression'].includes(n.expression.type)),
  );
  if (unsafe || comments.some((c) => /^mini-(off|on)\b/.test(c.value.trim()))) {
    setup(
      ast,
      unsafe
        ? 'Statement control flow or mutation: retained whole program'
        : 'Compiler directives: retained whole program',
      source,
    );
    return { doc, warnings };
  }
  const definitions = new Map<string, JS.Expression>();
  for (const statement of ast.body)
    if (statement.type === 'VariableDeclaration' && statement.declarations.length === 1) {
      const declaration = statement.declarations[0];
      if (declaration.id.type === 'Identifier' && declaration.init)
        definitions.set(declaration.id.name, declaration.init);
    }
  // Keep const bindings in evaluation order. This preserves lexical dependencies
  // in opaque code as well as shared patterns without guessing JavaScript scope.
  function leading(node: JS.Node): Comment | undefined {
    return comments
      .filter(
        (c) => c.end <= span(node).start && /^[\s(]*$/.test(source.slice(c.end, span(node).start)),
      )
      .at(-1);
  }
  function metadata(node: JS.Node, tag: string): Record<string, unknown> | undefined {
    // A part annotation can wrap a pattern that has its own annotation. Acorn
    // omits grouping parentheses from that expression's span, so allow nested
    // metadata comments between the annotation and its expression.
    const comment = comments
      .filter(
        (c) =>
          c.value.startsWith(`@odm-${tag} `) &&
          c.end <= span(node).start &&
          /^[\s(]*$/.test(
            source.slice(c.end, span(node).start).replace(/\/\*@odm-[\s\S]*?\*\//g, ''),
          ),
      )
      .at(-1);
    if (!comment) return;
    try {
      const value: unknown = JSON.parse(comment.value.slice(tag.length + 6));
      if (value && typeof value === 'object' && !Array.isArray(value))
        return value as Record<string, unknown>;
    } catch {
      /* User-edited metadata is just a comment. */
    }
  }
  function vocabulary(p: Pattern, node: JS.Node): Pattern {
    const data = metadata(node, 'pattern'),
      comment = leading(node);
    if (data) {
      if (typeof data.label === 'string') p.label = data.label;
      if (typeof data.comment === 'string') p.comment = data.comment;
      if (typeof data.muted === 'boolean') p.muted = data.muted;
    } else if (comment && !comment.value.startsWith('@odm-')) p.comment = comment.value.trim();
    return p;
  }
  const make = (node: JS.Node, tier: Tier, core: Pattern['core'], role?: Role): Pattern => ({
    ...meta(node, tier, role),
    core,
    layers: [],
  });
  function opaque(node: JS.Node, why = `Not modelled: ${node.type}`): Pattern {
    const p = make(node, 3, { kind: 'opaque', code: text(node) });
    warning(node, why, p.id);
    return p;
  }
  function pattern(node: JS.Node, hole?: string, constantString = false): Pattern {
    return vocabulary(parsePattern(node, hole, constantString), node);
  }
  function parsePattern(node: JS.Node, hole?: string, constantString = false): Pattern {
    const value = literal(node);
    if (value) {
      if (typeof value.value === 'string' && !constantString) {
        try {
          const steps = parseSteps(value.value);
          return make(node, 1, { kind: 'sequence', steps, notation: printSteps(steps) }, 'rhythm');
        } catch {
          return opaque(node, 'Unparsed mini notation retained verbatim');
        }
      }
      return make(
        node,
        1,
        value.value === null || typeof value.value === 'object'
          ? { kind: 'data', value: value.value }
          : { kind: 'constant', value: value.value },
        'argument',
      );
    }
    if (node.type === 'Identifier') {
      if (node.name === hole) return make(node, 1, { kind: 'hole' }, 'argument');
      if (definitions.has(node.name)) return make(node, 1, { kind: 'ref', name: node.name });
      if (node.name === 'silence')
        return make(node, 1, { kind: 'generator', name: 'silence', args: [] });
      if (signals.has(node.name) && node.name !== 'irand')
        return make(node, 1, { kind: 'signal', shape: node.name }, 'driver');
      return opaque(node, 'Unresolved identifier');
    }
    if (node.type !== 'CallExpression' || node.optional) return opaque(node);
    if (
      node.callee.type === 'MemberExpression' &&
      !node.callee.computed &&
      !node.callee.optional &&
      node.callee.property.type === 'Identifier'
    ) {
      const receiver = node.callee.object;
      const name = canonicalName(node.callee.property.name);
      if (
        name === 'filterWhen' &&
        node.arguments.length === 1 &&
        text(node.arguments[0]).replace(/\s/g, '') === '()=>false' &&
        metadata(node, 'pattern')?.muted === true
      )
        return { ...pattern(receiver, hole), muted: true };
      const origin = root(receiver),
        primitive = origin.type === 'Identifier' ? definitions.get(origin.name) : origin;
      if (
        (primitive?.type === 'Literal' &&
          typeof primitive.value === 'string' &&
          text(primitive).startsWith("'") &&
          !patternMethods.has(name)) ||
        (origin.type === 'Identifier' &&
          origin.name !== hole &&
          !signals.has(origin.name) &&
          !definitions.has(origin.name) &&
          origin.name !== 'silence')
      )
        return opaque(node, 'Computed receiver');
      const base = pattern(receiver, hole);
      if (outputs.has(name)) {
        const m = meta(node, 3);
        base.layers.push({
          ...m,
          kind: 'opaque',
          code: source.slice(span(receiver).end, span(node).end),
        });
        warning(node, 'Side-effect output retained', m.id);
      } else if (controlNames.has(node.callee.property.name) && node.arguments.length === 1) {
        const setting = {
          ...meta(node, understoodControls.has(name) ? 1 : 2, 'setting'),
          name,
          value: pattern(node.arguments[0], hole),
        };
        const last = base.layers.at(-1);
        if (last?.kind === 'settings' && !last.settings.some((s) => s.name === name))
          last.settings.push(setting);
        else
          base.layers.push({ ...meta(node, 1, 'setting'), kind: 'settings', settings: [setting] });
      } else {
        // An implicit-target lfo refers to the preceding call. Pull that call out
        // of the unordered bag before sorting any settings.
        if (name === 'lfo') {
          const last = base.layers.at(-1);
          if (last?.kind === 'settings') {
            const target = last.settings.pop();
            if (!last.settings.length) base.layers.pop();
            if (target)
              base.layers.push({
                id: target.id,
                tier: target.tier,
                role: 'setting',
                span: target.span,
                kind: 'rewrite',
                name: target.name,
                args: [{ kind: 'pattern', pattern: target.value }],
              });
          }
        }
        const signal =
          base.core.kind === 'signal' ||
          (base.core.kind === 'generator' && signals.has(base.core.name));
        const tier =
          understoodControls.has(name) ||
          rewrites.has(name) ||
          (['range', 'rangex', 'segment'].includes(name) && signal)
            ? 1
            : 2;
        base.layers.push({
          ...meta(
            node,
            tier,
            controlNames.has(name)
              ? 'setting'
              : rewrites.has(name) || name === 'FX'
                ? 'rewrite'
                : signal || name === 'lfo'
                  ? 'driver'
                  : undefined,
          ),
          kind: 'rewrite',
          name,
          args: node.arguments.map((n) => argument(n, hole)),
        });
      }
      return base;
    }
    if (
      node.callee.type !== 'Identifier' ||
      ['eval', ...outputs, ...setupCalls].includes(node.callee.name)
    )
      return opaque(node);
    const name = canonicalName(node.callee.name);
    if (groups.has(name)) {
      const parts: GroupPart[] = [];
      for (const item of node.arguments) {
        let n: JS.Node = item,
          cycles: number | undefined;
        if (name === 'arrange') {
          if (
            item.type !== 'ArrayExpression' ||
            item.elements.length !== 2 ||
            !item.elements[0] ||
            !item.elements[1]
          )
            return opaque(node, 'Computed arrangement');
          const count = literal(item.elements[0])?.value;
          if (typeof count !== 'number') return opaque(node, 'Computed arrangement duration');
          cycles = count;
          n = item.elements[1];
        }
        const data = metadata(n, 'part');
        if (
          data?.muted === true &&
          n.type === 'CallExpression' &&
          n.callee.type === 'MemberExpression' &&
          n.callee.property.type === 'Identifier' &&
          n.callee.property.name === 'filterWhen' &&
          n.arguments.length === 1 &&
          text(n.arguments[0]).replace(/\s/g, '') === '()=>false'
        )
          n = n.callee.object;
        const part: GroupPart = {
          pattern: pattern(n, hole),
          ...(cycles !== undefined ? { cycles } : {}),
        };
        if (data && typeof data.label === 'string') part.label = data.label;
        if (data && typeof data.muted === 'boolean') part.muted = data.muted;
        parts.push(part);
      }
      return make(node, 1, { kind: 'group', how: name, parts }, 'section');
    }
    if (signals.has(name))
      return make(
        node,
        1,
        { kind: 'signal', shape: name, args: node.arguments.map((n) => argument(n, hole)) },
        'driver',
      );
    return make(
      node,
      understoodControls.has(name) || ['pure', 'mini'].includes(name) ? 1 : 2,
      { kind: 'generator', name, args: node.arguments.map((n) => argument(n, hole)) },
      ['s', 'note', 'n'].includes(name) ? 'instrument' : undefined,
    );
  }
  function argument(node: JS.Node, hole?: string): Arg {
    const value = literal(node);
    if (value)
      return typeof value.value === 'string' && text(node).startsWith('"')
        ? { kind: 'pattern', pattern: pattern(node, hole) }
        : { kind: 'literal', value: value.value };
    if (
      node.type === 'ArrowFunctionExpression' &&
      !node.async &&
      node.params.length === 1 &&
      node.params[0].type === 'Identifier' &&
      node.body.type !== 'BlockStatement'
    ) {
      const parameter = node.params[0].name,
        origin = root(node.body);
      if (origin.type === 'Identifier' && origin.name === parameter)
        return { kind: 'callback', parameter, body: pattern(node.body, parameter) };
    }
    if (['CallExpression', 'Identifier'].includes(node.type)) {
      const p = pattern(node, hole);
      if (p.core.kind !== 'opaque' || p.layers.length) return { kind: 'pattern', pattern: p };
      // Opaque arguments have no Meta in the contract. Their warning keeps its
      // source span, without pointing at the discarded temporary Pattern id.
      for (const item of warnings) if (item.nodeId === p.id) delete item.nodeId;
    } else warning(node, `Opaque argument: ${node.type}`);
    return { kind: 'opaque', code: text(node) };
  }
  const labelled = ast.body.some((n) => n.type === 'LabeledStatement');
  for (const statement of ast.body) {
    if (statement.type === 'EmptyStatement') continue;
    if (statement.type === 'VariableDeclaration' && statement.declarations.length === 1) {
      const d = statement.declarations[0];
      if (d.id.type === 'Identifier' && d.init) {
        const p = vocabulary(
          pattern(d.init, undefined, d.init.type === 'Literal' && d.init.raw?.startsWith("'")),
          statement,
        );
        p.label = d.id.name;
        doc.body.push({ ...meta(statement, 1), kind: 'shared', name: d.id.name, pattern: p });
        continue;
      }
    }
    const expr = statement.type === 'ExpressionStatement' ? statement.expression : undefined;
    if (expr?.type === 'CallExpression' && expr.callee.type === 'Identifier') {
      const name = expr.callee.name;
      if (['setcpm', 'setCpm', 'setcps'].includes(name) && expr.arguments.length === 1) {
        const value = literal(expr.arguments[0])?.value;
        if (typeof value === 'number') {
          doc.body.push({
            ...meta(statement, 1, 'setup'),
            kind: 'tempo',
            cpm: name === 'setcps' ? value * 60 : value,
          });
          continue;
        }
      }
      if (name === 'all') {
        doc.body.push({
          ...meta(expr, 2, 'rewrite'),
          kind: 'transform',
          name: 'all',
          args: expr.arguments.map((n) => argument(n)),
        });
        continue;
      }
      if (setupCalls.has(name)) {
        setup(
          statement,
          name === 'register'
            ? 'Register body retained verbatim'
            : 'Setup effect retained verbatim',
        );
        continue;
      }
    }
    if (
      expr?.type === 'CallExpression' &&
      expr.callee.type === 'MemberExpression' &&
      expr.callee.object.type === 'Identifier' &&
      expr.callee.object.name === 'console'
    ) {
      setup(statement, 'Setup output retained verbatim');
      continue;
    }
    const isLabel =
      statement.type === 'LabeledStatement' && statement.body.type === 'ExpressionStatement';
    if (isLabel || (expr && expr.type !== 'AwaitExpression')) {
      const expression =
        isLabel &&
        statement.type === 'LabeledStatement' &&
        statement.body.type === 'ExpressionStatement'
          ? statement.body.expression
          : expr!;
      const p = vocabulary(pattern(expression), statement);
      const authorLabel =
        statement.type === 'LabeledStatement' && !statement.label.name.includes('$')
          ? statement.label.name
          : undefined;
      const constRoot = root(expression);
      const constName =
        constRoot.type === 'Identifier' && definitions.has(constRoot.name)
          ? constRoot.name
          : undefined;
      let nameSource: 'author' | 'generated' = authorLabel || constName ? 'author' : 'generated';
      let name =
        authorLabel ??
        constName ??
        `Instrument ${doc.body.filter((n) => n.kind === 'voice').length + 1}`;
      let muted =
        statement.type === 'LabeledStatement'
          ? statement.label.name.startsWith('_') || statement.label.name.endsWith('_')
          : labelled || statement !== ast.body.at(-1);
      // Voice metadata is between the label and expression, whereas pattern
      // metadata belongs immediately beside the pattern it describes.
      const voiceComment = comments.find(
        (c) =>
          c.start > span(statement).start &&
          c.end <= span(expression).start &&
          c.value.startsWith('@odm-voice '),
      );
      let data: Record<string, unknown> | undefined;
      if (voiceComment) {
        try {
          data = JSON.parse(voiceComment.value.slice(11));
        } catch {
          /* Retain user-edited metadata as a comment. */
        }
      }
      if (data) {
        if (typeof data.name === 'string') name = data.name;
        if (data.nameSource === 'author' || data.nameSource === 'generated')
          nameSource = data.nameSource;
        if (typeof data.muted === 'boolean') muted = data.muted;
      }
      if (authorLabel && !muted && !data)
        for (const previous of doc.body)
          if (previous.kind === 'voice' && previous.name === name) previous.muted = true;
      if (authorLabel && !data) p.label = authorLabel;
      doc.body.push({
        ...meta(statement, 1, 'instrument'),
        kind: 'voice',
        name,
        nameSource,
        muted,
        pattern: p,
      });
    } else
      setup(
        statement,
        expr?.type === 'AwaitExpression'
          ? 'Awaited setup retained verbatim'
          : 'Statement retained verbatim',
      );
  }
  walk(doc, (n) => {
    if ('kind' in n && n.kind === 'settings') {
      const layer = n as import('../document').SettingsLayer;
      layer.settings.sort((a, b) => a.name.localeCompare(b.name));
    }
  });
  return { doc, warnings };
};
