import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { posix } from 'node:path';
export function boundaryProblems(path, code) {
  const problems = [];
  const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  function visit(node) {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              node.expression.getText(source) === 'require')
          ? node.arguments[0]
          : undefined;
    if (specifier && ts.isStringLiteralLike(specifier)) {
      const name = specifier.text;
      const target = name.startsWith('.')
        ? posix.normalize(posix.join(posix.dirname(path), name))
        : name;
      const staffEngraver =
        name === 'vexflow' &&
        (path === 'src/views/staff.view.ts' || path.startsWith('src/views/staff/'));
      if (
        path.startsWith('src/views/') &&
        !target.startsWith('src/views/') &&
        !/^three(?:\/|$)/.test(name) &&
        !staffEngraver
      )
        problems.push('Views may import only views and three');
      if (
        /^src\/(document|import|generate|engine|strudel)\//.test(path) &&
        (/^(react|react-dom)(\/|$)/.test(name) ||
          /^src\/(studio|components|views)(\/|$)/.test(target))
      )
        problems.push('Logic directories must stay framework-free');
      if (/^(?:@strudel\/|superdough(?:\/|$))/.test(name) && !path.startsWith('src/strudel/'))
        problems.push('Strudel imports belong in src/strudel/');
      if (/^(src|tests)\//.test(path) && /(^|\/)spikes(\/|$)/.test(name))
        problems.push('Frozen spikes cannot be imported');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (
    /^(scripts|tests|\.github)\/|config\.|^package\.json$/.test(path) &&
    /\bport["']?\s*[:=]\s*[1-9]\d*|\bPORT\s*=\s*[1-9]\d*|--port(?:=|\s*)[1-9]\d*|https?:\/\/[^\s/"'`]+:[1-9]\d*|\blisten\s*\(\s*[1-9]\d*/.test(
      code,
    )
  )
    problems.push('Fixed port: ask the OS with port 0');
  if (/\bvite\b[^\n]*--port(?:=|\s*)0\b/.test(code))
    problems.push('Vite CLI port 0 selects its default; use scripts/dev.mjs');
  return problems;
}
const excluded = new Set([
  '.git',
  'node_modules',
  'dist',
  'spikes',
  'corpus',
  'research',
  '.agents',
  'test-results',
  'playwright-report',
]);
function scan(dir = '.') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name) || entry.name.startsWith('.browser-')) return [];
    const path = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) return scan(path);
    if (!/\.(?:[cm]?[jt]sx?|json|ya?ml)$/.test(path) || path === 'package-lock.json') return [];
    return boundaryProblems(path, readFileSync(path, 'utf8')).map(
      (problem) => `${path}: ${problem}`,
    );
  });
}
if (import.meta.main) {
  const problems = scan();
  console.log(problems.length ? problems.join('\n') : 'Boundaries OK');
  if (problems.length) process.exitCode = 1;
}
