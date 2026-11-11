// ../import/src/import.ts
import { parse as parse2 } from "acorn";

// ../import/src/registry.ts
import * as controls from "@strudel/core/controls.mjs";
import { Pattern as StrudelPattern } from "@strudel/core/pattern.mjs";
import State from "@strudel/core/state.mjs";
import TimeSpan from "@strudel/core/timespan.mjs";
var exported = controls;
var controlNames = /* @__PURE__ */ new Map();
for (const [name, fn] of Object.entries(exported)) {
  if (!controls.isControlName(name) || typeof fn !== "function") continue;
  const bag = fn(0).query(new State(new TimeSpan(0, 1)))[0]?.value;
  const canonical = bag && Object.keys(bag)[0];
  if (canonical) controlNames.set(name, canonical);
}
for (const name of Object.getOwnPropertyNames(StrudelPattern.prototype)) {
  if (controls.isControlName(name) && !controlNames.has(name))
    controlNames.set(name, name);
}
var canonicalName = (name) => controlNames.get(name) ?? name;
var tierOneControls = new Set(
  `s note n gain velocity lpf hpf lpq hpq pan delay delaytime delayfeedback room roomsize orbit attack decay sustain release speed begin end cut clip legato vowel crush distort shape scale`.split(" ").map(canonicalName)
);
var signals = new Set(
  "sine cosine saw isaw tri square perlin rand irand time".split(" ")
);
var rewrites = new Set(
  "fast slow early late rev ply euclid euclidRot degradeBy sometimes sometimesBy often rarely every firstOf off jux superimpose layer struct mask".split(
    " "
  )
);
var groups = /* @__PURE__ */ new Set(["stack", "cat", "seq", "arrange"]);
var patternMethods = new Set(
  Object.getOwnPropertyNames(StrudelPattern.prototype)
);

// ../import/src/mini.ts
import { parse } from "@strudel/mini/krill-parser.js";
function miniNode(value) {
  if (!value || typeof value !== "object" || !("type_" in value) || typeof value.type_ !== "string")
    throw Error("Invalid Strudel mini AST");
  return value;
}
function parseSteps(notation) {
  const quoted = JSON.stringify(notation);
  const root = miniNode(parse(quoted));
  const raw = (n) => n.location_ ? quoted.slice(n.location_.start.offset, n.location_.end.offset).trim() : notation;
  function step(n) {
    if (n.type_ === "atom")
      return n.source_ === "~" ? { kind: "rest" } : { kind: "value", value: String(n.source_) };
    if (n.type_ === "element" && n.source_ && !Array.isArray(n.source_) && typeof n.source_ === "object") {
      const ops = n.options_?.ops ?? [];
      if (ops.some((o) => !["replicate", "degradeBy"].includes(o.type_)))
        return { kind: "other", notation: raw(n) };
      const child = step(n.source_);
      if (child.kind === "other") return { kind: "other", notation: raw(n) };
      const weight = n.options_?.weight ?? 1, repeat = n.options_?.reps ?? 1;
      if ((weight !== 1 || repeat !== 1 || ops.length) && child.kind !== "value" && child.kind !== "rest" && child.kind !== "sub")
        return { kind: "other", notation: raw(n) };
      if (child.kind === "value" || child.kind === "rest" || child.kind === "sub") {
        if (weight !== repeat) child.weight = weight;
        if (repeat !== 1) {
          if (child.kind !== "value")
            return { kind: "other", notation: raw(n) };
          child.repeat = repeat;
        }
        const chance = ops.find((o) => o.type_ === "degradeBy");
        if (chance) {
          if (child.kind !== "value")
            return { kind: "other", notation: raw(n) };
          child.chance = chance.arguments_.amount ?? 0.5;
        }
      }
      return child;
    }
    if (n.type_ === "pattern" && Array.isArray(n.source_)) {
      const alignment = n.arguments_?.alignment;
      if (alignment === "fastcat")
        return { kind: "sub", steps: n.source_.map(step) };
      if (alignment === "polymeter_slowcat" || alignment === "stack") {
        const children = n.source_.flatMap(
          (c) => c.type_ === "pattern" && c.arguments_?.alignment === "fastcat" && Array.isArray(c.source_) && (alignment === "polymeter_slowcat" || c.source_.length === 1) ? c.source_.map(step) : [step(c)]
        );
        return {
          kind: alignment === "stack" ? "together" : "alternate",
          steps: children
        };
      }
      return { kind: "other", notation: raw(n) };
    }
    return { kind: "other", notation: raw(n) };
  }
  return root.type_ === "pattern" && root.arguments_?.alignment === "fastcat" && Array.isArray(root.source_) ? root.source_.map(step) : [step(root)];
}
function printSteps(steps) {
  const one = (s) => {
    let text;
    switch (s.kind) {
      case "value":
        text = s.value;
        break;
      case "rest":
        text = "~";
        break;
      case "sub":
        text = `[${printSteps(s.steps)}]`;
        break;
      case "alternate":
        return `<${printSteps(s.steps)}>`;
      case "together":
        return `[${s.steps.map(one).join(",")}]`;
      case "other":
        return s.notation;
    }
    if ("weight" in s && s.weight !== void 0) text += `@${s.weight}`;
    if (s.kind === "value" && s.repeat !== void 0) text += `!${s.repeat}`;
    if (s.kind === "value" && s.chance !== void 0)
      text += s.chance === 0.5 ? "?" : `?${s.chance}`;
    return text;
  };
  return steps.map(one).join(" ");
}

// ../import/src/import.ts
var outputs = new Set(
  "log scope pianoroll punchcard spiral spectrum osc midi midin out output draw analyze onTrigger".split(
    " "
  )
);
var setupCalls = new Set(
  "samples hush register setcpm setCpm setcps setbpm".split(" ")
);
function position(node) {
  if ("start" in node && "end" in node && typeof node.start === "number" && typeof node.end === "number")
    return { start: node.start, end: node.end };
  throw Error("Parser omitted source offsets");
}
function visit(node, f, parent) {
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
function plain(node) {
  if (node.type === "Literal" && (node.value === null || ["string", "number", "boolean"].includes(typeof node.value)))
    return { value: node.value };
  if (node.type === "UnaryExpression" && ["-", "+"].includes(node.operator)) {
    const x = plain(node.argument)?.value;
    if (typeof x === "number") return { value: node.operator === "-" ? -x : x };
  }
  if (node.type === "BinaryExpression") {
    const a = plain(node.left)?.value, b = plain(node.right)?.value;
    if (typeof a === "number" && typeof b === "number") {
      const value = node.operator === "/" ? a / b : node.operator === "*" ? a * b : node.operator === "+" ? a + b : node.operator === "-" ? a - b : NaN;
      if (Number.isFinite(value)) return { value };
    }
  }
  if (node.type === "ArrayExpression") {
    const values = [];
    for (const el of node.elements) {
      const item = el && !(el.type === "Literal" && typeof el.value === "string" && el.raw?.startsWith('"')) && plain(el);
      if (!item) return;
      values.push(item.value);
    }
    return { value: values };
  }
  if (node.type === "ObjectExpression") {
    const value = {};
    for (const p of node.properties) {
      if (p.type !== "Property" || p.computed || p.method || p.kind !== "init" || p.shorthand)
        return;
      const key = p.key.type === "Identifier" ? p.key.name : p.key.type === "Literal" ? String(p.key.value) : void 0;
      const item = !(p.value.type === "Literal" && typeof p.value.value === "string" && p.value.raw?.startsWith('"')) && plain(p.value);
      if (key === void 0 || !item || key === "__proto__") return;
      value[key] = item.value;
    }
    return { value };
  }
}
function chainRoot(node) {
  return node.type === "CallExpression" && node.callee.type === "MemberExpression" && !node.callee.computed && !node.optional && !node.callee.optional ? chainRoot(node.callee.object) : node;
}
function reason(node) {
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
      return node.callee.type === "Identifier" && node.callee.name === "eval" ? "eval" : "computed call";
    default:
      return `computed ${node.type}`;
  }
}
function importStrudel(source) {
  let serial = 0;
  const warnings = [];
  const retained = /* @__PURE__ */ new Set();
  const order = [];
  const transforms = [];
  const doc = { setup: [], voices: [], shared: {}, order, transforms };
  const meta = (node, tier) => ({
    id: `n${++serial}`,
    tier,
    span: position(node)
  });
  const text = (node) => {
    const s = position(node);
    return source.slice(s.start, s.end);
  };
  function remember(node) {
    visit(node, (n) => {
      if (n.type === "Identifier" && globalReferences.has(n))
        retained.add(n.name);
    });
  }
  function opaque(node, why = reason(node)) {
    remember(node);
    warnings.push(`${why}: ${text(node)}`);
    return {
      ...meta(node, 3),
      core: { kind: "opaque", code: text(node) },
      layers: []
    };
  }
  function setup(node, why) {
    remember(node);
    warnings.push(`${why}: ${text(node)}`);
    order.push({ kind: "setup", index: doc.setup.length });
    doc.setup.push({ ...meta(node, 3), code: text(node) });
  }
  const comments = [];
  let program;
  try {
    program = parse2(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      onComment: comments
    });
  } catch (error) {
    doc.setup.push({ id: "n1", tier: 3, code: source });
    order.push({ kind: "setup", index: 0 });
    return { doc, warnings: [`JavaScript parse error: ${String(error)}`] };
  }
  if (comments.some(
    (c) => c.value.trim().startsWith("mini-off") || c.value.trim().startsWith("mini-on")
  )) {
    doc.setup.push({ ...meta(program, 3), code: source });
    order.push({ kind: "setup", index: 0 });
    return { doc, warnings: ["compiler directive: entire program preserved"] };
  }
  const definitions = /* @__PURE__ */ new Map();
  for (const statement of program.body)
    if (statement.type === "VariableDeclaration" && statement.kind === "const" && statement.declarations.length === 1) {
      const d = statement.declarations[0];
      if (d.id.type === "Identifier" && d.init)
        definitions.set(d.id.name, { init: d.init, statement, count: 0 });
    }
  const globalReferences = /* @__PURE__ */ new Set();
  function references(node, shadowed = /* @__PURE__ */ new Set(), parent) {
    let scope = shadowed;
    if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration") {
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
    if (node.type === "Identifier" && definitions.has(node.name) && !scope.has(node.name)) {
      const declaration = parent?.type === "VariableDeclarator" && parent.id === node;
      const property = parent?.type === "MemberExpression" && parent.property === node && !parent.computed || parent?.type === "Property" && parent.key === node && !parent.computed;
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
  const topUnsafe = program.body.some(
    (s) => [
      "IfStatement",
      "ForStatement",
      "ForOfStatement",
      "ForInStatement",
      "WhileStatement",
      "DoWhileStatement"
    ].includes(s.type) || s.type === "VariableDeclaration" && s.kind !== "const" || s.type === "ExpressionStatement" && ["AssignmentExpression", "UpdateExpression"].includes(
      s.expression.type
    )
  );
  if (topUnsafe) {
    doc.setup.push({ ...meta(program, 3), code: source });
    order.push({ kind: "setup", index: 0 });
    return {
      doc,
      warnings: ["statement control flow/mutation: entire program preserved"]
    };
  }
  const active = /* @__PURE__ */ new Set();
  function definitionPattern(node, hole) {
    if (node.type === "Literal" && typeof node.value === "string" && text(node).startsWith("'"))
      return {
        ...meta(node, 1),
        core: { kind: "constant", value: node.value },
        layers: []
      };
    return pattern(node, hole);
  }
  function leadingComment(node) {
    return comments.filter(
      (c) => c.end <= position(node).start && /^\s*$/.test(source.slice(c.end, position(node).start))
    ).at(-1);
  }
  function vocabulary(p, node) {
    const c = leadingComment(node);
    if (!c) return p;
    if (c.value.startsWith("@odm-pattern ")) {
      try {
        const data = JSON.parse(c.value.slice("@odm-pattern ".length));
        if (data && typeof data === "object") {
          if ("muted" in data && typeof data.muted === "boolean")
            p.muted = data.muted;
          if ("label" in data && typeof data.label === "string")
            p.label = data.label;
          if ("comment" in data && typeof data.comment === "string")
            p.comment = data.comment;
        }
      } catch {
      }
    } else if (!c.value.startsWith("@odm-voice ")) {
      p.comment = c.value.trim();
    }
    return p;
  }
  function pattern(node, hole) {
    return vocabulary(parsePattern(node, hole), node);
  }
  function parsePattern(node, hole) {
    const p = plain(node);
    if (p && typeof p.value === "string") {
      try {
        const steps = parseSteps(p.value);
        return {
          ...meta(node, 1),
          core: { kind: "sequence", steps, notation: printSteps(steps) },
          layers: []
        };
      } catch {
        return opaque(node, "mini parse error");
      }
    }
    if (p)
      return {
        ...meta(node, 1),
        core: p.value === null || typeof p.value === "object" ? { kind: "data", value: p.value } : { kind: "constant", value: p.value },
        layers: []
      };
    if (node.type === "Identifier") {
      if (node.name === "silence" && !definitions.has(node.name))
        return {
          ...meta(node, 1),
          core: { kind: "generator", name: "silence", args: [] },
          layers: []
        };
      if (node.name === hole)
        return { ...meta(node, 1), core: { kind: "hole" }, layers: [] };
      if (signals.has(node.name) && node.name !== "irand")
        return {
          ...meta(node, 1),
          core: { kind: "signal", shape: node.name },
          layers: []
        };
      const def = globalReferences.has(node) ? definitions.get(node.name) : void 0;
      if (def && !active.has(node.name)) {
        if (def.count > 1)
          return {
            ...meta(node, 1),
            core: { kind: "ref", name: node.name },
            layers: []
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
    if (node.callee.type === "MemberExpression" && !node.callee.computed && !node.callee.optional && node.callee.property.type === "Identifier") {
      const receiver = node.callee.object;
      const metadata = leadingComment(node);
      if (node.callee.property.name === "filterWhen" && node.arguments.length === 1 && text(node.arguments[0]).replace(/\s/g, "") === "()=>false" && metadata?.value.startsWith("@odm-pattern ")) {
        try {
          const data = JSON.parse(
            metadata.value.slice("@odm-pattern ".length)
          );
          if (data && typeof data === "object" && "muted" in data && data.muted === true)
            return { ...pattern(receiver, hole), muted: true };
        } catch {
        }
      }
      const name2 = canonicalName(node.callee.property.name);
      const root = chainRoot(receiver);
      const primitive = root.type === "Identifier" ? definitions.get(root.name)?.init : root;
      if (primitive?.type === "Literal" && typeof primitive.value === "string" && text(primitive).startsWith("'") && !patternMethods.has(node.callee.property.name))
        return opaque(node, "computed call");
      if (root.type === "Identifier" && root.name !== hole && !definitions.has(root.name) && !signals.has(root.name))
        return opaque(node, "computed call");
      const base = pattern(receiver, hole);
      if (outputs.has(name2)) {
        node.arguments.forEach(remember);
        warnings.push(
          `side-effect output: ${text(node).slice(text(receiver).length)}`
        );
        base.layers.push({
          ...meta(node, 3),
          kind: "opaque",
          code: source.slice(position(receiver).end, position(node).end)
        });
      } else if (controlNames.has(node.callee.property.name) && node.arguments.length === 1) {
        const setting = {
          ...meta(node, tierOneControls.has(name2) ? 1 : 2),
          name: name2,
          value: pattern(node.arguments[0], hole)
        };
        const last = base.layers.at(-1);
        if (last?.kind === "settings" && !last.settings.some((x) => x.name === name2))
          last.settings.push(setting);
        else
          base.layers.push({
            ...meta(node, 1),
            kind: "settings",
            settings: [setting]
          });
      } else {
        if (name2 === "lfo") {
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
                args: [{ kind: "pattern", pattern: target.value }]
              });
          }
        }
        const tier2 = tierOneControls.has(name2) || rewrites.has(name2) || ["add", "sub"].includes(name2) && (containsNote(base) || node.arguments.some(
          (n) => n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "note"
        )) || ["range", "rangex", "segment"].includes(name2) && (base.core.kind === "signal" || base.core.kind === "generator" && signals.has(base.core.name)) ? 1 : 2;
        base.layers.push({
          ...meta(node, tier2),
          kind: "rewrite",
          name: name2,
          args: node.arguments.map((n) => arg(n, hole))
        });
      }
      return base;
    }
    if (node.callee.type !== "Identifier" || node.callee.name === "eval" || outputs.has(node.callee.name) || setupCalls.has(node.callee.name))
      return opaque(node);
    const name = canonicalName(node.callee.name);
    if (groups.has(name)) {
      const parts = [];
      for (const n of node.arguments) {
        if (name === "arrange") {
          if (n.type !== "ArrayExpression" || n.elements.length !== 2 || !n.elements[0] || !n.elements[1])
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
        layers: []
      };
    }
    const tier = tierOneControls.has(name) || signals.has(name) || name === "pure" || name === "mini" ? 1 : 2;
    return {
      ...meta(node, tier),
      core: {
        kind: "generator",
        name,
        args: node.arguments.map((n) => arg(n, hole))
      },
      layers: []
    };
  }
  function arg(node, hole) {
    const value = plain(node);
    if (value)
      return typeof value.value === "string" && text(node).startsWith('"') ? { kind: "pattern", pattern: pattern(node, hole) } : { kind: "literal", value: value.value };
    if (node.type === "ArrowFunctionExpression" && !node.async && node.params.length === 1 && node.params[0].type === "Identifier" && node.body.type !== "BlockStatement") {
      const parameter = node.params[0].name, root = chainRoot(node.body);
      if (root.type === "Identifier" && root.name === parameter)
        return {
          kind: "callback",
          parameter,
          body: pattern(node.body, parameter)
        };
    }
    if (node.type === "CallExpression" || node.type === "Identifier") {
      const result = pattern(node, hole);
      if (!result.layers.length && (result.core.kind === "constant" || result.core.kind === "data"))
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
  function containsNote(p) {
    return p.core.kind === "ref" && !!doc.shared[p.core.name] && containsNote(doc.shared[p.core.name]) || p.core.kind === "generator" && ["note", "n"].includes(p.core.name) || p.layers.some(
      (l) => l.kind === "settings" && l.settings.some((s) => ["note", "n"].includes(s.name))
    );
  }
  const labelled = program.body.some((s) => s.type === "LabeledStatement");
  const lastStatement = program.body.at(-1);
  for (const statement of program.body) {
    if (statement.type === "EmptyStatement") continue;
    if (statement.type === "VariableDeclaration" && statement.declarations.length === 1 && statement.declarations[0].id.type === "Identifier") {
      const name = statement.declarations[0].id.name, def = definitions.get(name);
      if (def) {
        if (def.count > 1) {
          active.add(name);
          doc.shared[name] = vocabulary(
            definitionPattern(def.init),
            def.statement
          );
          doc.shared[name].label = name;
          active.delete(name);
          order.push({ kind: "shared", name });
        } else if (def.count === 0) setup(statement, "unused declaration");
        continue;
      }
    }
    const expr = statement.type === "ExpressionStatement" ? statement.expression : void 0;
    if (expr?.type === "CallExpression" && expr.callee.type === "Identifier") {
      const name = expr.callee.name;
      if (["setcpm", "setCpm", "setcps"].includes(name) && expr.arguments.length === 1 && !doc.tempo) {
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
          args: expr.arguments.map((n) => arg(n))
        });
        continue;
      }
      if (setupCalls.has(name)) {
        setup(
          statement,
          name === "register" ? "register body" : "setup effect"
        );
        continue;
      }
    }
    if (expr?.type === "CallExpression" && expr.callee.type === "MemberExpression" && expr.callee.object.type === "Identifier" && expr.callee.object.name === "console") {
      setup(statement, "side-effect setup");
      continue;
    }
    if (statement.type === "LabeledStatement" && statement.body.type === "ExpressionStatement") {
      let name = statement.label.name, muted = name.startsWith("_") || name.endsWith("_");
      const comment = comments.find(
        (c) => c.start > position(statement).start && c.end <= position(statement.body).start && c.value.startsWith("@odm-voice ")
      );
      if (comment) {
        try {
          const data = JSON.parse(
            comment.value.slice("@odm-voice ".length)
          );
          if (data && typeof data === "object" && "name" in data && typeof data.name === "string" && "muted" in data && typeof data.muted === "boolean") {
            name = data.name;
            muted = data.muted;
          }
        } catch {
        }
      }
      if (!name.includes("$") && !muted) {
        for (const previous of doc.voices)
          if (previous.name === name) previous.muted = true;
      }
      order.push({ kind: "voice", index: doc.voices.length });
      doc.voices.push({
        ...meta(statement, 1),
        name,
        muted,
        pattern: pattern(statement.body.expression)
      });
    } else if (expr && expr.type !== "AwaitExpression") {
      order.push({ kind: "voice", index: doc.voices.length });
      doc.voices.push({
        ...meta(statement, 1),
        name: "$",
        muted: labelled || statement !== lastStatement,
        pattern: pattern(expr)
      });
    } else
      setup(
        statement,
        expr?.type === "AwaitExpression" ? "awaited setup" : "statement/declaration"
      );
  }
  function entryOffset(entry) {
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
          (s) => s.type === "ExpressionStatement" && s.expression.type === "CallExpression" && s.expression.callee.type === "Identifier" && ["setcpm", "setCpm", "setcps"].includes(s.expression.callee.name)
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
      (entry) => entryOffset(entry) > position(def.statement).start
    );
    order.splice(at < 0 ? order.length : at, 0, { kind: "shared", name });
  }
  return { doc, warnings };
}

// ../import/src/generate.ts
function literal(value) {
  if (typeof value === "string")
    return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "\\n").replaceAll("\r", "\\r")}'`;
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value).map(([k, v]) => `${literal(k)}: ${literal(v)}`).join(", ")}}`;
  return JSON.stringify(value);
}
function argument(arg, hole) {
  switch (arg.kind) {
    case "literal":
      return literal(arg.value);
    case "pattern":
      return generatePattern(arg.pattern, hole);
    case "opaque":
      return arg.code;
    case "callback": {
      const parameter = arg.parameter ?? "p";
      return `${parameter} => ${generatePattern(arg.body, parameter)}`;
    }
  }
}
function generatePattern(p, hole) {
  let text;
  const core = p.core;
  switch (core.kind) {
    case "sequence":
      text = JSON.stringify(printSteps(core.steps));
      break;
    case "constant":
      text = literal(core.value);
      break;
    case "data":
      text = literal(core.value);
      break;
    case "signal":
      text = core.shape;
      break;
    case "ref":
      text = core.name;
      break;
    case "hole":
      text = hole ?? "p";
      break;
    case "opaque":
      text = `(${core.code})`;
      break;
    case "generator":
      text = core.name === "silence" && !core.args.length ? "silence" : `${core.name}(${core.args.map((a) => argument(a, hole)).join(", ")})`;
      break;
    case "group":
      text = `${core.how}(${core.parts.map((part) => core.how === "arrange" ? `[${part.cycles ?? 1}, ${generatePattern(part.pattern, hole)}]` : generatePattern(part.pattern, hole)).join(", ")})`;
      break;
  }
  if (p.layers.length && ["constant", "data"].includes(core.kind))
    text = `pure(${text})`;
  for (const layer of p.layers) {
    if (layer.kind === "settings")
      for (const setting of layer.settings)
        text += `.${setting.name}(${generatePattern(setting.value, hole)})`;
    else if (layer.kind === "rewrite")
      text += `.${layer.name}(${layer.args.map((a) => argument(a, hole)).join(", ")})`;
    else text += layer.code;
  }
  if (p.muted) text += ".filterWhen(()=>false)";
  if (p.label !== void 0 || p.comment !== void 0 || p.muted) {
    const metadata = JSON.stringify({
      muted: p.muted || void 0,
      label: p.label,
      comment: p.comment
    }).replaceAll("*/", "*\\/");
    text = `(/*@odm-pattern ${metadata}*/ ${text})`;
  }
  return text;
}
function generate(doc) {
  const setup = (i) => doc.setup[i]?.code ?? "";
  const shared = (name) => doc.shared[name] ? `const ${name} = ${generatePattern(doc.shared[name])};` : "";
  const voice = (i) => {
    const v = doc.voices[i];
    if (!v) return "";
    const metadata = JSON.stringify({
      name: v.name,
      muted: v.muted
    }).replaceAll("*/", "*\\/");
    return `${v.muted ? "_$" : "$"}: /*@odm-voice ${metadata}*/ ${generatePattern(v.pattern)};`;
  };
  const tempo = () => doc.tempo ? `setcpm(${doc.tempo.cpm});` : "";
  const transform = (i) => {
    const t = doc.transforms?.[i];
    return t ? `all(${t.args.map((a) => argument(a)).join(", ")});` : "";
  };
  if (doc.setup.length === 1 && !doc.voices.length && !Object.keys(doc.shared).length && !doc.tempo && !doc.transforms?.length)
    return doc.setup[0].code;
  const lines = [];
  if (doc.order) {
    const emitted = {
      setup: /* @__PURE__ */ new Set(),
      shared: /* @__PURE__ */ new Set(),
      voice: /* @__PURE__ */ new Set(),
      transform: /* @__PURE__ */ new Set(),
      tempo: false
    };
    for (const entry of doc.order)
      switch (entry.kind) {
        case "setup":
          if (!emitted.setup.has(entry.index)) lines.push(setup(entry.index));
          emitted.setup.add(entry.index);
          break;
        case "shared":
          if (!emitted.shared.has(entry.name)) lines.push(shared(entry.name));
          emitted.shared.add(entry.name);
          break;
        case "voice":
          if (!emitted.voice.has(entry.index)) lines.push(voice(entry.index));
          emitted.voice.add(entry.index);
          break;
        case "tempo":
          if (!emitted.tempo) lines.push(tempo());
          emitted.tempo = true;
          break;
        case "transform":
          if (!emitted.transform.has(entry.index))
            lines.push(transform(entry.index));
          emitted.transform.add(entry.index);
          break;
      }
    if (!emitted.tempo && doc.tempo) lines.unshift(tempo());
    doc.setup.forEach((_, i) => {
      if (!emitted.setup.has(i)) lines.push(setup(i));
    });
    Object.keys(doc.shared).forEach((name) => {
      if (!emitted.shared.has(name)) lines.push(shared(name));
    });
    doc.voices.forEach((_, i) => {
      if (!emitted.voice.has(i)) lines.push(voice(i));
    });
    doc.transforms?.forEach((_, i) => {
      if (!emitted.transform.has(i)) lines.push(transform(i));
    });
  } else
    lines.push(
      tempo(),
      ...doc.setup.map((_, i) => setup(i)),
      ...Object.keys(doc.shared).map(shared),
      ...doc.voices.map((_, i) => voice(i)),
      ...(doc.transforms ?? []).map((_, i) => transform(i))
    );
  return lines.filter(Boolean).join("\n") + "\n";
}

// ../import/src/query.ts
async function queryEvents(source, fromCycle, toCycle) {
  if (!Number.isFinite(fromCycle) || !Number.isFinite(toCycle) || toCycle <= fromCycle || toCycle - fromCycle > 512)
    return { events: [], error: "Invalid query window (maximum 512 cycles)" };
  if (typeof process !== "undefined" && process.versions?.node) {
    const moduleName = "node:worker_threads";
    const { Worker: NodeWorker } = await import(
      /* @vite-ignore */
      moduleName
    );
    return new Promise((resolve) => {
      const worker = new NodeWorker(
        new URL("./node-worker.mjs", import.meta.url),
        {
          workerData: { source, fromCycle, toCycle },
          // A file worker cannot inherit the caller's eval/stdin-only flag.
          execArgv: process.execArgv.filter(
            (arg, i, args) => !arg.startsWith("--input-type") && args[i - 1] !== "--input-type"
          ),
          stdout: true,
          stderr: true
        }
      );
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate().catch(() => {
        });
        resolve(result);
      };
      const timer = setTimeout(
        () => finish({
          events: [],
          error: "5000ms worker budget exceeded",
          phase: "timeout"
        }),
        5e3
      );
      worker.once("message", finish);
      worker.once(
        "error",
        (error) => finish({ events: [], error: error.message, phase: "evaluation" })
      );
      worker.once("exit", (code) => {
        if (!settled)
          finish({
            events: [],
            error: `Worker exited ${code}`,
            phase: "evaluation"
          });
      });
    });
  }
  return new Promise((resolve) => {
    const worker = new Worker(
      new URL("./browser-worker.mjs", import.meta.url),
      { type: "module" }
    );
    const finish = (result) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({
        events: [],
        error: "5000ms worker budget exceeded",
        phase: "timeout"
      }),
      5e3
    );
    worker.onmessage = (event) => finish(event.data);
    worker.onerror = (event) => finish({ events: [], error: event.message, phase: "evaluation" });
    worker.postMessage({ source, fromCycle, toCycle });
  });
}
export {
  generate,
  generatePattern,
  importStrudel,
  queryEvents
};
