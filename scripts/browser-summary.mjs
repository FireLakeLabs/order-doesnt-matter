export const SINGLE_TEST_LIMIT_MS = 20_000;

/** @typedef {{title: string, status: string, ms: number, sharedSetupMs?: number, budgetException?: string}} TimingRow */

/** @param {TimingRow[]} rows
 * @param {number} wallSeconds
 * Pure accounting, shared by the runner and boundary tests. Skips cost no tests. */
export function browserSummary(rows, wallSeconds, mode = 'ci') {
  const tests = rows.filter((row) => row.status !== 'skipped');
  const slowest = [...tests].sort((a, b) => b.ms - a.ms).slice(0, 5);
  const over = tests.filter((row) => row.ms > SINGLE_TEST_LIMIT_MS);
  const exceptions = mode === 'demo' ? over.filter((row) => row.budgetException) : [];
  return {
    exceptions,
    count: tests.length,
    secondsPerTest: tests.length ? wallSeconds / tests.length : 0,
    slowest,
    sharedSetup: tests.filter((row) => row.sharedSetupMs !== undefined),
    over,
    ok: over.length === exceptions.length,
  };
}

export function formatBrowserSummary(summary) {
  return [
    `Browser tests: ${summary.count}; ${summary.secondsPerTest.toFixed(3)} s/test (complete command)`,
    'Five slowest tests (Playwright, including per-test hooks):',
    ...summary.slowest.map((row) => `  ${(row.ms / 1000).toFixed(3)} s ${row.title}`),
    ...summary.sharedSetup.map(
      (row) =>
        `Reported shared setup (already in wall time): ${(Number(row.sharedSetupMs) / 1000).toFixed(3)} s ${row.title}`,
    ),
    ...summary.over.map((row) =>
      summary.exceptions.includes(row)
        ? `OPTIONAL RECORDING EXCEPTION (20 s guard): ${row.title} — ${row.budgetException}`
        : `OVER SINGLE-TEST BUDGET (20 s): ${row.title}`,
    ),
  ].join('\n');
}
