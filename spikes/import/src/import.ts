import { parse, type Comment } from "acorn";
import type * as JS from "estree";
import type { Arg, Doc, JsonValue, Meta, Pattern, Tier } from "./document.ts";
import {
  canonicalName,
  controlNames,
  groups,
  patternMethods,
  rewrites,
  signals,
  tierOneControls,
} from "./registry.ts";
import { parseSteps, printSteps } from "./mini.ts";

const outputs = new Set(
  "log scope pianoroll punchcard spiral spectrum osc midi midin out output draw analyze onTrigger".split(
    " ",
  ),
);
const setupCalls = new Set(
  "samples hush register setcpm setCpm setcps setbpm".split(" "),
);
function position(node: JS.Node): { start: number; end: number } {
  if (
    "start" in node &&
    "end" in node &&
    typeof node.start === "number" &&
    typeof node.end === "number"
  )
    return { start: node.start, end: node.end };
  throw Error("Parser omitted source offsets");
}
function visit(
  node: JS.Node,
  f: (node: JS.Node, parent?: JS.Node) => void,
  parent?: JS.Node,
): void {
  f(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value))
      for (const child of value) {
        if (child && typeof child === "object" && "type" in child)
          visit(child, f, node);
      }
    else if (value && typeof value === "object" && "type" in value)
      visit(value, f, node);
  }
}
// Deliberately bounded constant folding, never evaluation. Fractions such as
// 1/8 and tempo 90/4 are numbers, not opaque user computation.
function plain(node: JS.Node): { value: JsonValue } | undefined {
  if (
    node.type === "Literal" &&
    (node.value === null ||
      ["string", "number", "boolean"].includes(typeof node.value))
  )
    return { value: node.value as JsonValue };
  if (node.type === "UnaryExpression" && ["-", "+"].includes(node.operator)) {
    const x = plain(node.argument)?.value;
    if (typeof x === "number") return { value: node.operator === "-" ? -x : x };
  }
  if (node.type === "BinaryExpression") {
    const a = plain(node.left)?.value,
      b = plain(node.right)?.value;
    if (typeof a === "number" && typeof b === "number") {
      const value =
        node.operator === "/"
          ? a / b
          : node.operator === "*"
            ? a * b
            : node.operator === "+"
              ? a + b
              : node.operator === "-"
                ? a - b
                : NaN;
      if (Number.isFinite(value)) return { value };
    }
  }
  if (node.type === "ArrayExpression") {
    const values: JsonValue[] = [];
    for (const el of node.elements) {
      const item =
        el &&
        !(
          el.type === "Literal" &&
          typeof el.value === "string" &&
          el.raw?.startsWith('"')
        ) &&
        plain(el);
      if (!item) return;
      values.push(item.value);
    }
    return { value: values };
  }
  if (node.type === "ObjectExpression") {
    const value: Record<string, JsonValue> = {};
    for (const p of node.properties) {
      if (
        p.type !== "Property" ||
        p.computed ||
        p.method ||
        p.kind !== "init" ||
        p.shorthand
      )
        return;
      const key =
        p.key.type === "Identifier"
          ? p.key.name
          : p.key.type === "Literal"
            ? String(p.key.value)
            : undefined;
      const item =
        !(
          p.value.type === "Literal" &&
          typeof p.value.value === "string" &&
          p.value.raw?.startsWith('"')
        ) && plain(p.value);
      if (key === undefined || !item || key === "__proto__") return;
      value[key] = item.value;
    }
    return { value };
  }
}
function chainRoot(node: JS.Node): JS.Node {
  return node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    !node.optional &&
    !node.callee.optional
    ? chainRoot(node.callee.object)
    : node;
}
function reason(node: JS.Node): string {
  switch (node.type) {
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return "non-chain callback";
    case "NewExpression":
      return "hand-built object/pattern";
    case "TemplateLiteral":
      return "template string";
    case "Identifier":
      return "unresolved identifier";
    case "CallExpression":
      return node.callee.type === "Identifier" && node.callee.name === "eval"
        ? "eval"
        : "computed call";
    default:
      return `computed ${node.type}`;
  }
}
export function importStrudel(source: string): {
  doc: Doc;
  warnings: string[];
} {
  let serial = 0;
  const warnings: string[] = [];
  const retained = new Set<string>();
  const order: NonNullable<Doc["order"]> = [];
  const transforms: NonNullable<Doc["transforms"]> = [];
  const doc: Doc = { setup: [], voices: [], shared: {}, order, transforms };
  const meta = (node: JS.Node, tier: Tier): Meta => ({
    id: `n${++serial}`,
    tier,
    span: position(node),
  });
  const text = (node: JS.Node) => {
    const s = position(node);
    return source.slice(s.start, s.end);
  };
  function remember(node: JS.Node): void {
    visit(node, (n) => {
      if (n.type === "Identifier" && globalReferences.has(n))
        retained.add(n.name);
    });
  }
  function opaque(node: JS.Node, why = reason(node)): Pattern {
    remember(node);
    warnings.push(`${why}: ${text(node)}`);
    return {
      ...meta(node, 3),
      core: { kind: "opaque", code: text(node) },
      layers: [],
    };
  }
  function setup(node: JS.Node, why: string): void {
    remember(node);
    warnings.push(`${why}: ${text(node)}`);
    order.push({ kind: "setup", index: doc.setup.length });
    doc.setup.push({ ...meta(node, 3), code: text(node) });
  }
  const comments: Comment[] = [];
  let program: JS.Program;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      onComment: comments,
    }) as unknown as JS.Program;
  } catch (error) {
    doc.setup.push({ id: "n1", tier: 3, code: source });
    order.push({ kind: "setup", index: 0 });
    return { doc, warnings: [`JavaScript parse error: ${String(error)}`] };
  }
  if (
    comments.some(
      (c) =>
        c.value.trim().startsWith("mini-off") ||
        c.value.trim().startsWith("mini-on"),
    )
  ) {
    doc.setup.push({ ...meta(program, 3), code: source });
    order.push({ kind: "setup", index: 0 });
    return { doc, warnings: ["compiler directive: entire program preserved"] };
  }
  const definitions = new Map<
    string,
    { init: JS.Expression; statement: JS.VariableDeclaration; count: number }
  >();
  for (const statement of program.body)
    if (
      statement.type === "VariableDeclaration" &&
      statement.kind === "const" &&
      statement.declarations.length === 1
    ) {
      const d = statement.declarations[0];
      if (d.id.type === "Identifier" && d.init)
        definitions.set(d.id.name, { init: d.init, statement, count: 0 });
    }
  const globalReferences = new Set<JS.Identifier>();
  function references(
    node: JS.Node,
    shadowed = new Set<string>(),
    parent?: JS.Node,
  ): void {
    let scope = shadowed;
    if (
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression" ||
      node.type === "FunctionDeclaration"
    ) {
      scope = new Set(shadowed);
      for (const parameter of node.params)
        visit(parameter, (n) => {
          if (n.type === "Identifier") scope.add(n.name);
        });
      if (node.type !== "ArrowFunctionExpression" && node.id)
        scope.add(node.id.name);
    }
    if (node.type === "BlockStatement") {
      scope = new Set(scope);
      for (const statement of node.body) {
        if (statement.type === "VariableDeclaration")
          for (const d of statement.declarations)
            visit(d.id, (n) => {
              if (n.type === "Identifier") scope.add(n.name);
            });
        if (statement.type === "FunctionDeclaration" && statement.id)
          scope.add(statement.id.name);
      }
    }
    if (
      node.type === "Identifier" &&
      definitions.has(node.name) &&
      !scope.has(node.name)
    ) {
      const declaration =
        parent?.type === "VariableDeclarator" && parent.id === node;
      const property =
        (parent?.type === "MemberExpression" &&
          parent.property === node &&
          !parent.computed) ||
        (parent?.type === "Property" &&
          parent.key === node &&
          !parent.computed);
      if (!declaration && !property) {
        const def = definitions.get(node.name);
        if (def) def.count++;
        globalReferences.add(node);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value)
          if (child && typeof child === "object" && "type" in child)
            references(child, scope, node);
      } else if (value && typeof value === "object" && "type" in value)
        references(value, scope, node);
    }
  }
  references(program);
  // Lexical mutation/branching or opaque references can require exact statement
  // order and binding identity. Preserve the whole program when splitting would
  // change that identity. Ordinary opaque arguments do not trigger this fallback.
  const topUnsafe = program.body.some(
    (s) =>
      [
        "IfStatement",
        "ForStatement",
        "ForOfStatement",
        "ForInStatement",
        "WhileStatement",
        "DoWhileStatement",
      ].includes(s.type) ||
      (s.type === "VariableDeclaration" && s.kind !== "const") ||
      (s.type === "ExpressionStatement" &&
        ["AssignmentExpression", "UpdateExpression"].includes(
          s.expression.type,
        )),
  );
  if (topUnsafe) {
    doc.setup.push({ ...meta(program, 3), code: source });
    order.push({ kind: "setup", index: 0 });
    return {
      doc,
      warnings: ["statement control flow/mutation: entire program preserved"],
    };
  }
  const active = new Set<string>();
  function definitionPattern(node: JS.Expression, hole?: string): Pattern {
    if (
      node.type === "Literal" &&
      typeof node.value === "string" &&
      text(node).startsWith("'")
    )
      return {
        ...meta(node, 1),
        core: { kind: "constant", value: node.value },
        layers: [],
      };
    return pattern(node, hole);
  }
  function leadingComment(node: JS.Node): Comment | undefined {
    return comments
      .filter(
        (c) =>
          c.end <= position(node).start &&
          /^\s*$/.test(source.slice(c.end, position(node).start)),
      )
      .at(-1);
  }
  function vocabulary(p: Pattern, node: JS.Node): Pattern {
    const c = leadingComment(node);
    if (!c) return p;
    if (c.value.startsWith("@odm-pattern ")) {
      try {
        const data: unknown = JSON.parse(c.value.slice("@odm-pattern ".length));
        if (data && typeof data === "object") {
          if ("muted" in data && typeof data.muted === "boolean")
            p.muted = data.muted;
          if ("label" in data && typeof data.label === "string")
            p.label = data.label;
          if ("comment" in data && typeof data.comment === "string")
            p.comment = data.comment;
        }
      } catch {}
    } else if (!c.value.startsWith("@odm-voice ")) {
      p.comment = c.value.trim();
    }
    return p;
  }
  function pattern(node: JS.Node, hole?: string): Pattern {
    return vocabulary(parsePattern(node, hole), node);
  }
  function parsePattern(node: JS.Node, hole?: string): Pattern {
    const p = plain(node);
    if (p && typeof p.value === "string") {
      try {
        const steps = parseSteps(p.value);
        return {
          ...meta(node, 1),
          core: { kind: "sequence", steps, notation: printSteps(steps) },
          layers: [],
        };
      } catch {
        return opaque(node, "mini parse error");
      }
    }
    if (p)
      return {
        ...meta(node, 1),
        core:
          p.value === null || typeof p.value === "object"
            ? { kind: "data", value: p.value }
            : { kind: "constant", value: p.value },
        layers: [],
      };
    if (node.type === "Identifier") {
      if (node.name === "silence" && !definitions.has(node.name))
        return {
          ...meta(node, 1),
          core: { kind: "generator", name: "silence", args: [] },
          layers: [],
        };
      if (node.name === hole)
        return { ...meta(node, 1), core: { kind: "hole" }, layers: [] };
      if (signals.has(node.name) && node.name !== "irand")
        return {
          ...meta(node, 1),
          core: { kind: "signal", shape: node.name },
          layers: [],
        };
      const def = globalReferences.has(node)
        ? definitions.get(node.name)
        : undefined;
      if (def && !active.has(node.name)) {
        if (def.count > 1)
          return {
            ...meta(node, 1),
            core: { kind: "ref", name: node.name },
            layers: [],
          };
        active.add(node.name);
        const result = definitionPattern(def.init, hole);
        active.delete(node.name);
        vocabulary(result, def.statement);
        result.label = node.name;
        return result;
      }
      return opaque(node);
    }
    if (node.type !== "CallExpression" || node.optional) return opaque(node);
    if (
      node.callee.type === "MemberExpression" &&
      !node.callee.computed &&
      !node.callee.optional &&
      node.callee.property.type === "Identifier"
    ) {
      const receiver = node.callee.object;
      // Our generated mute suffix has explicit metadata. Keep the original
      // score editable, rather than importing the suffix as opaque user code.
      const metadata = leadingComment(node);
      if (
        node.callee.property.name === "filterWhen" &&
        node.arguments.length === 1 &&
        text(node.arguments[0]).replace(/\s/g, "") === "()=>false" &&
        metadata?.value.startsWith("@odm-pattern ")
      ) {
        try {
          const data: unknown = JSON.parse(
            metadata.value.slice("@odm-pattern ".length),
          );
          if (
            data &&
            typeof data === "object" &&
            "muted" in data &&
            data.muted === true
          )
            return { ...pattern(receiver, hole), muted: true };
        } catch {}
      }
      const name = canonicalName(node.callee.property.name);
      const root = chainRoot(receiver);
      const primitive =
        root.type === "Identifier" ? definitions.get(root.name)?.init : root;
      if (
        primitive?.type === "Literal" &&
        typeof primitive.value === "string" &&
        text(primitive).startsWith("'") &&
        !patternMethods.has(node.callee.property.name)
      )
        return opaque(node, "computed call");
      if (
        root.type === "Identifier" &&
        root.name !== hole &&
        !definitions.has(root.name) &&
        !signals.has(root.name)
      )
        return opaque(node, "computed call");
      const base = pattern(receiver, hole);
      if (outputs.has(name)) {
        node.arguments.forEach(remember);
        warnings.push(
          `side-effect output: ${text(node).slice(text(receiver).length)}`,
        );
        base.layers.push({
          ...meta(node, 3),
          kind: "opaque",
          code: source.slice(position(receiver).end, position(node).end),
        });
      } else if (
        controlNames.has(node.callee.property.name) &&
        node.arguments.length === 1
      ) {
        const setting = {
          ...meta(node, tierOneControls.has(name) ? 1 : 2),
          name,
          value: pattern(node.arguments[0], hole),
        };
        const last = base.layers.at(-1);
        if (
          last?.kind === "settings" &&
          !last.settings.some((x) => x.name === name)
        )
          last.settings.push(setting);
        else
          base.layers.push({
            ...meta(node, 1),
            kind: "settings",
            settings: [setting],
          });
      } else {
        if (name === "lfo") {
          const last = base.layers.at(-1);
          if (last?.kind === "settings") {
            const target = last.settings.pop();
            if (!last.settings.length) base.layers.pop();
            if (target)
              base.layers.push({
                id: target.id,
                tier: target.tier,
                span: target.span,
                kind: "rewrite",
                name: target.name,
                args: [{ kind: "pattern", pattern: target.value }],
              });
          }
        }
        const tier: Tier =
          tierOneControls.has(name) ||
          rewrites.has(name) ||
          (["add", "sub"].includes(name) &&
            (containsNote(base) ||
              node.arguments.some(
                (n) =>
                  n.type === "CallExpression" &&
                  n.callee.type === "Identifier" &&
                  n.callee.name === "note",
              ))) ||
          (["range", "rangex", "segment"].includes(name) &&
            (base.core.kind === "signal" ||
              (base.core.kind === "generator" && signals.has(base.core.name))))
            ? 1
            : 2;
        base.layers.push({
          ...meta(node, tier),
          kind: "rewrite",
          name,
          args: node.arguments.map((n) => arg(n, hole)),
        });
      }
      return base;
    }
    if (
      node.callee.type !== "Identifier" ||
      node.callee.name === "eval" ||
      outputs.has(node.callee.name) ||
      setupCalls.has(node.callee.name)
    )
      return opaque(node);
    const name = canonicalName(node.callee.name);
    if (groups.has(name)) {
      const parts = [];
      for (const n of node.arguments) {
        if (name === "arrange") {
          if (
            n.type !== "ArrayExpression" ||
            n.elements.length !== 2 ||
            !n.elements[0] ||
            !n.elements[1]
          )
            return opaque(node, "computed arrange duration");
          const cycles = plain(n.elements[0])?.value;
          if (typeof cycles !== "number")
            return opaque(node, "computed arrange duration");
          parts.push({ cycles, pattern: pattern(n.elements[1], hole) });
        } else parts.push({ pattern: pattern(n, hole) });
      }
      return {
        ...meta(node, 1),
        core: { kind: "group", how: name, parts },
        layers: [],
      };
    }
    const tier: Tier =
      tierOneControls.has(name) ||
      signals.has(name) ||
      name === "pure" ||
      name === "mini"
        ? 1
        : 2;
    return {
      ...meta(node, tier),
      core: {
        kind: "generator",
        name,
        args: node.arguments.map((n) => arg(n, hole)),
      },
      layers: [],
    };
  }
  function arg(node: JS.Node, hole?: string): Arg {
    const value = plain(node);
    if (value)
      return typeof value.value === "string" && text(node).startsWith('"')
        ? { kind: "pattern", pattern: pattern(node, hole) }
        : { kind: "literal", value: value.value };
    if (
      node.type === "ArrowFunctionExpression" &&
      !node.async &&
      node.params.length === 1 &&
      node.params[0].type === "Identifier" &&
      node.body.type !== "BlockStatement"
    ) {
      const parameter = node.params[0].name,
        root = chainRoot(node.body);
      if (root.type === "Identifier" && root.name === parameter)
        return {
          kind: "callback",
          parameter,
          body: pattern(node.body, parameter),
        };
    }
    if (node.type === "CallExpression" || node.type === "Identifier") {
      const result = pattern(node, hole);
      if (
        !result.layers.length &&
        (result.core.kind === "constant" || result.core.kind === "data")
      )
        return { kind: "literal", value: result.core.value };
      if (result.core.kind !== "opaque" || result.layers.length)
        return { kind: "pattern", pattern: result };
      remember(node);
      return { kind: "opaque", code: text(node) };
    }
    remember(node);
    warnings.push(`${reason(node)}: ${text(node)}`);
    return { kind: "opaque", code: text(node) };
  }
  function containsNote(p: Pattern): boolean {
    return (
      (p.core.kind === "ref" &&
        !!doc.shared[p.core.name] &&
        containsNote(doc.shared[p.core.name])) ||
      (p.core.kind === "generator" && ["note", "n"].includes(p.core.name)) ||
      p.layers.some(
        (l) =>
          l.kind === "settings" &&
          l.settings.some((s) => ["note", "n"].includes(s.name)),
      )
    );
  }
  const labelled = program.body.some((s) => s.type === "LabeledStatement");
  const lastStatement = program.body.at(-1);
  for (const statement of program.body) {
    if (statement.type === "EmptyStatement") continue;
    if (
      statement.type === "VariableDeclaration" &&
      statement.declarations.length === 1 &&
      statement.declarations[0].id.type === "Identifier"
    ) {
      const name = statement.declarations[0].id.name,
        def = definitions.get(name);
      if (def) {
        if (def.count > 1) {
          active.add(name);
          doc.shared[name] = vocabulary(
            definitionPattern(def.init),
            def.statement,
          );
          doc.shared[name].label = name;
          active.delete(name);
          order.push({ kind: "shared", name });
        } else if (def.count === 0) setup(statement, "unused declaration");
        continue;
      }
    }
    const expr =
      statement.type === "ExpressionStatement"
        ? statement.expression
        : undefined;
    if (expr?.type === "CallExpression" && expr.callee.type === "Identifier") {
      const name = expr.callee.name;
      if (
        ["setcpm", "setCpm", "setcps"].includes(name) &&
        expr.arguments.length === 1 &&
        !doc.tempo
      ) {
        const tempo = plain(expr.arguments[0])?.value;
        if (typeof tempo === "number") {
          doc.tempo = { cpm: name === "setcps" ? tempo * 60 : tempo };
          order.push({ kind: "tempo" });
          continue;
        }
      }
      if (name === "all") {
        order.push({ kind: "transform", index: transforms.length });
        transforms.push({
          ...meta(expr, 2),
          name: "all",
          args: expr.arguments.map((n) => arg(n)),
        });
        continue;
      }
      if (setupCalls.has(name)) {
        setup(
          statement,
          name === "register" ? "register body" : "setup effect",
        );
        continue;
      }
    }
    if (
      expr?.type === "CallExpression" &&
      expr.callee.type === "MemberExpression" &&
      expr.callee.object.type === "Identifier" &&
      expr.callee.object.name === "console"
    ) {
      setup(statement, "side-effect setup");
      continue;
    }
    if (
      statement.type === "LabeledStatement" &&
      statement.body.type === "ExpressionStatement"
    ) {
      let name = statement.label.name,
        muted = name.startsWith("_") || name.endsWith("_");
      const comment = comments.find(
        (c) =>
          c.start > position(statement).start &&
          c.end <= position(statement.body).start &&
          c.value.startsWith("@odm-voice "),
      );
      if (comment) {
        try {
          const data: unknown = JSON.parse(
            comment.value.slice("@odm-voice ".length),
          );
          if (
            data &&
            typeof data === "object" &&
            "name" in data &&
            typeof data.name === "string" &&
            "muted" in data &&
            typeof data.muted === "boolean"
          ) {
            name = data.name;
            muted = data.muted;
          }
        } catch {}
      }
      if (!name.includes("$") && !muted)
        for (const previous of doc.voices)
          if (previous.name === name) previous.muted = true;
      order.push({ kind: "voice", index: doc.voices.length });
      doc.voices.push({
        ...meta(statement, 1),
        name,
        muted,
        pattern: pattern(statement.body.expression),
      });
    } else if (expr && expr.type !== "AwaitExpression") {
      order.push({ kind: "voice", index: doc.voices.length });
      doc.voices.push({
        ...meta(statement, 1),
        name: "$",
        muted: labelled || statement !== lastStatement,
        pattern: pattern(expr),
      });
    } else
      setup(
        statement,
        expr?.type === "AwaitExpression"
          ? "awaited setup"
          : "statement/declaration",
      );
  }
  // Preserve lexical dependencies of opaque source using the original AST's
  // scope-aware references. Setup statements cannot be reparsed as expressions.
  function entryOffset(entry: NonNullable<Doc["order"]>[number]): number {
    switch (entry.kind) {
      case "setup":
        return doc.setup[entry.index]?.span?.start ?? Infinity;
      case "voice":
        return doc.voices[entry.index]?.span?.start ?? Infinity;
      case "shared":
        return doc.shared[entry.name]?.span?.start ?? Infinity;
      case "transform":
        return transforms[entry.index]?.span?.start ?? Infinity;
      case "tempo": {
        const statement = program.body.find(
          (s) =>
            s.type === "ExpressionStatement" &&
            s.expression.type === "CallExpression" &&
            s.expression.callee.type === "Identifier" &&
            ["setcpm", "setCpm", "setcps"].includes(s.expression.callee.name),
        );
        return statement ? position(statement).start : Infinity;
      }
    }
  }
  for (const name of retained) {
    if (doc.shared[name]) continue;
    const def = definitions.get(name);
    if (!def) continue;
    active.add(name);
    doc.shared[name] = vocabulary(definitionPattern(def.init), def.statement);
    doc.shared[name].label = name;
    active.delete(name);
    const at = order.findIndex(
      (entry) => entryOffset(entry) > position(def.statement).start,
    );
    order.splice(at < 0 ? order.length : at, 0, { kind: "shared", name });
  }
  return { doc, warnings };
}
