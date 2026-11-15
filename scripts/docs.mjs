import { readFileSync } from 'node:fs';
export const docPaths = ['AGENTS.md', 'docs/model.md', 'docs/decisions.md', 'docs/standards.md'];
export function inspectDocs(read = (path) => readFileSync(path, 'utf8')) {
  return docPaths.map((path) => {
    try {
      read(path);
      return { path, ok: true };
    } catch {
      return { path, ok: false };
    }
  });
}
if (import.meta.main) {
  const rows = inspectDocs();
  console.table(rows);
  if (rows.some((row) => !row.ok)) process.exitCode = 1;
}
