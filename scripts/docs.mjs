import { readFileSync } from 'node:fs';
export const docBudgets = {
  'AGENTS.md': 400,
  'docs/model.md': 1000,
  'docs/decisions.md': 1500,
  'docs/standards.md': 800,
};
export function inspectDocs(read = (path) => readFileSync(path, 'utf8')) {
  return Object.entries(docBudgets).map(([path, limit]) => {
    try {
      const words = read(path).match(/\S+/g)?.length ?? 0;
      return { path, words, limit, ok: words <= limit };
    } catch {
      return { path, words: 'missing', limit, ok: false };
    }
  });
}
if (import.meta.main) {
  const rows = inspectDocs();
  console.table(rows);
  if (rows.some((row) => !row.ok)) process.exitCode = 1;
}
