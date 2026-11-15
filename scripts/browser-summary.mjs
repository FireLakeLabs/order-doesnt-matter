/** @typedef {{title: string, status: string, ms: number, sharedSetupMs?: number}} TimingRow */

/** @param {TimingRow[]} rows
 * @param {number} wallSeconds
 * Pure accounting, shared by the runner and boundary tests. Skips cost no tests. */
export function browserSummary(rows, wallSeconds) {
  const tests = rows.filter((row) => row.status !== 'skipped');
  const slowest = [...tests].sort((a, b) => b.ms - a.ms).slice(0, 5);
  return {
    count: tests.length,
    secondsPerTest: tests.length ? wallSeconds / tests.length : 0,
    slowest,
    sharedSetup: tests.filter((row) => row.sharedSetupMs !== undefined),
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
  ].join('\n');
}
