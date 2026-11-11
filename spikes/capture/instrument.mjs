import { parse } from 'acorn';
import escodegen from 'escodegen';
import { walk } from 'estree-walker';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

// Keep the pinned upstream rewrite pass intact. Inject hooks into its in-memory
// source: no patched dependency or sibling file. This keeps original mini offsets.
const require = createRequire(import.meta.url);
let upstream = readFileSync(new URL('../transpiler.mjs', import.meta.resolve('@strudel/transpiler')), 'utf8');
upstream = upstream.replace('const miniDisableRanges =', 'options.onParse?.(ast);\n  const miniDisableRanges =');
upstream = upstream.replace('let { body } = ast;', 'options.transformAST?.(ast);\n  let { body } = ast;');
upstream = upstream.replace('return this.replace(labelToP(node));', 'const replacement = labelToP(node); replacement.expression._capture = node._capture; return this.replace(replacement);');
// Imports in a data URL must resolve to absolute file URLs.
upstream = upstream.replace(/from '([^']+)'/g, (_, name) => `from '${import.meta.resolve(name)}'`);
const { transpiler, registerWidgetType } = await import('data:text/javascript;base64,' + Buffer.from(upstream).toString('base64'));
for (const name of ['scope', 'pianoroll', 'punchcard', 'spiral']) registerWidgetType(name);
const lit = value => ({ type: 'Literal', value });
const ident = name => ({ type: 'Identifier', name });
const makeHelper = (captureName, name, args) => ({ type: 'CallExpression', callee: { type: 'MemberExpression', object: ident(captureName), property: ident(name), computed: false }, arguments: args, optional: false });
const stmt = expression => ({ type: 'ExpressionStatement', expression });
const clone = x => structuredClone(x);

export function compile(source, mode = 'ast') {
  const sites = [], functions = [], warnings = [];
  let captureName = '__capture';
  const helper = (name,args) => makeHelper(captureName,name,args);
  const ids = new Map();
  const fnStack = [];
  function site(node, type, callee) {
    const signature = `${type}:${source.slice(node.start, node.end)}`;
    const occurrence = ids.get(signature) || 0; ids.set(signature, occurrence + 1);
    const id = createHash('sha256').update(signature).digest('hex').slice(0, 12) + ':' + occurrence;
    const meta = { id, span: { start: node.start, end: node.end, loc: node.loc }, callee, siteType: type };
    (type === 'callback' ? functions : sites).push(meta);
    node._capture = meta;
    return meta;
  }
  const options = {
    emitMiniLocations: true, emitWidgets: true,
    onParse(ast) {
      const identifiers = new Set();
      walk(ast, { enter(node) { if (node.type === 'Identifier') identifiers.add(node.name); } });
      while (identifiers.has(captureName)) captureName += '_';
      walk(ast, { enter(node, parent) {
        if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
          const owner = parent?.type === 'CallExpression' ? source.slice(parent.callee.start, parent.callee.end) : node.id?.name || 'user function';
          const f = site(node, 'callback', owner);
          f.ownerSite = parent?._capture?.id;
          f.argumentIndex = parent?.type === 'CallExpression' ? parent.arguments.indexOf(node) : undefined;
        }
        if (node.type === 'CallExpression') site(node, 'call', source.slice(node.callee.start, node.callee.end));
        if (node.type === 'LabeledStatement') site(node, 'root', node.label.name);
      }});
      walk(ast, { enter(node) { if (node.type === 'CallExpression') { node._capture.argumentSites = node.arguments.map(a=>a._capture?.id || null); node._capture.receiverSite = node.callee.type === 'MemberExpression' ? node.callee.object._capture?.id : undefined; } } });
    },
    transformAST(ast) {
      if (mode !== 'ast') return;
      walk(ast, {
        enter(node) { if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) fnStack.push(node); },
        leave(node) {
          if (node.type === 'ReturnStatement' && fnStack.length && node.argument) {
            node.argument = helper('returned', [lit(fnStack.at(-1)._capture.id), node.argument]);
          }
          if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
            fnStack.pop();
            const id = node._capture.id;
            let body = node.body.type === 'BlockStatement' ? node.body.body : [{ type: 'ReturnStatement', argument: helper('returned', [lit(id), node.body]) }];
            const directives = []; while (body[0]?.directive) directives.push(body.shift());
            // Entry instrumentation retains identity and .length (register uses arity).
            const params = node.params.map(p => p.type === 'Identifier' ? ident(p.name) : p.type === 'RestElement' && p.argument.type === 'Identifier' ? ident(p.argument.name) : lit('[destructured/default parameter]'));
            node.body = { type: 'BlockStatement', body: [...directives, stmt(helper('enter', [lit(id), { type: 'ArrayExpression', elements: params }])), {
              type: 'TryStatement', block: { type: 'BlockStatement', body }, handler: null,
              finalizer: { type: 'BlockStatement', body: [stmt(helper('exit', [lit(id)]))] }
            }] };
            node.expression = false;
            return;
          }
          if (node.type !== 'CallExpression' || !node._capture) return;
          const meta = node._capture;
          if (meta.siteType === 'root') return this.replace(helper('root', [lit(meta.id), node]));
          const callee = node.callee;
          // Direct eval and optional/super/private references cannot be lowered to
          // Reflect.apply without changing JS semantics. Preserve the original call.
          if (callee.type === 'Identifier' && callee.name === 'eval' || callee.type === 'Super' || callee.object?.type === 'Super' || callee.property?.type === 'PrivateIdentifier') {
            warnings.push({ site: meta.id, reason: 'result-only capture: direct eval/super/private call' });
            return this.replace(helper('result', [lit(meta.id), node]));
          }
          if (callee.type === 'MemberExpression' && callee.optional) {
            // Keep optional chaining in the same ChainExpression; the proxy only
            // mediates this single property lookup and retains the real receiver.
            callee.object = helper('optionalBase', [lit(meta.id), callee.object, lit(!!node.optional)]);
            return node;
          }
          node.callee = callee.type === 'MemberExpression'
            ? helper(node.optional ? 'optionalMember' : 'member', [lit(meta.id), callee.object, callee.computed ? callee.property : lit(callee.property.name)])
            : helper(node.optional ? 'optionalBare' : 'bare', [lit(meta.id), callee]);
          return node;
        }
      });
    }
  };
  const start = performance.now();
  const result = transpiler(source, options);
  return { code: result.output, captureName, sites, functions, warnings, miniLocations: result.miniLocations, widgets: result.widgets, compileMs: performance.now() - start };
}
