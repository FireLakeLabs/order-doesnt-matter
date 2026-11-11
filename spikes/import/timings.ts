import { writeFile } from "node:fs/promises";
import { format } from "prettier";
interface TimedProgram {
  id: string;
  importMs: number;
  generateMs: number;
  importTimes: number[];
  generateTimes: number[];
}
export async function writeTimings(reports: TimedProgram[]): Promise<void> {
  const rows = reports
    .map(
      (r) =>
        `| ${r.id} | ${r.importMs.toFixed(3)} | ${Math.max(...r.importTimes).toFixed(3)} | ${r.generateMs.toFixed(3)} | ${Math.max(...r.generateTimes).toFixed(3)} |`,
    )
    .join("\n");
  const table = `# Per-program timings\n\nMilliseconds; seven warmed samples per operation. See [measurement qualifications](BENCHMARK.md) and raw [results](results.json).\n\n| Program | Import median | Import worst | Generate median | Generate worst |\n| --- | ---: | ---: | ---: | ---: |\n${rows}\n`;
  await writeFile(
    new URL("TIMINGS.md", import.meta.url),
    await format(table, { parser: "markdown" }),
  );
}
