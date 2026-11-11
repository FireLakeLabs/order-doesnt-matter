import { writeTimings } from "./timings.ts";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { importStrudel, generate, queryEvents } from "./src/index.ts";
import { documentIdentity, eventIdentity, stable } from "./src/compare.ts";

const entries: { id: string; file: string }[] = JSON.parse(
  await readFile(new URL("../../corpus/index.json", import.meta.url), "utf8"),
);
await mkdir(new URL("out/", import.meta.url), { recursive: true });
await mkdir(new URL("generated/", import.meta.url), { recursive: true });
const reports = [];
for (const entry of entries) {
  const source = await readFile(
    new URL(`../../corpus/${entry.file}`, import.meta.url),
    "utf8",
  );
  // Warm parser/registry paths; alternate generation/import timing order per rep.
  const warm = importStrudel(source);
  generate(warm.doc);
  const importTimes: number[] = [],
    generateTimes: number[] = [];
  let imported = warm,
    generated = "";
  for (let round = 0; round < 7; round++) {
    const doImport = () => {
      const t = performance.now();
      imported = importStrudel(source);
      importTimes.push(performance.now() - t);
    };
    const doGenerate = () => {
      const t = performance.now();
      generated = generate(imported.doc);
      generateTimes.push(performance.now() - t);
    };
    if (round % 2) {
      doGenerate();
      doImport();
    } else {
      doImport();
      doGenerate();
    }
    if (
      documentIdentity(imported.doc) !== documentIdentity(warm.doc) ||
      generated !== generate(warm.doc)
    )
      throw Error(`Unstable timed output: ${entry.id}`);
  }
  const reimported = importStrudel(generated);
  const idempotent =
    documentIdentity(imported.doc) === documentIdentity(reimported.doc);
  await writeFile(
    new URL(`out/${entry.id}.json`, import.meta.url),
    JSON.stringify(imported.doc, null, 2) + "\n",
  );
  await writeFile(
    new URL(`generated/${entry.id}.strudel`, import.meta.url),
    generated,
  );
  const original = await queryEvents(source, 0, 16),
    fresh = await queryEvents(generated, 0, 16);
  const same = eventIdentity(original) === eventIdentity(fresh);
  const tiers: Record<string, number> = { "1": 0, "2": 0, "3": 0 },
    tier2: Record<string, number> = {},
    reasons: Record<string, number> = {};
  function nodes(value: unknown, parent?: unknown): void {
    if (!value || typeof value !== "object") return;
    if (
      "tier" in value &&
      typeof value.tier === "number" &&
      !("muted" in value) &&
      !("kind" in value && value.kind === "settings")
    ) {
      tiers[value.tier]++;
      if (value.tier === 2) {
        const name =
          "name" in value && typeof value.name === "string"
            ? value.name
            : "core" in value &&
                value.core &&
                typeof value.core === "object" &&
                "name" in value.core
              ? String(value.core.name)
              : "unknown";
        tier2[name] = (tier2[name] ?? 0) + 1;
      }
    }
    if (
      "kind" in value &&
      value.kind === "opaque" &&
      !("tier" in value) &&
      !(
        parent &&
        typeof parent === "object" &&
        "core" in parent &&
        parent.core === value
      )
    )
      tiers["3"]++;
    if ("kind" in value && value.kind === "literal") tiers["1"]++;
    for (const child of Object.values(value))
      if (child && typeof child === "object") nodes(child, value);
  }
  nodes(imported.doc);
  // Warnings correspond to opaque boundaries; a Pattern opaque core shares its
  // metadata with its Pattern and is counted once, not again as an argument.
  for (const warning of imported.warnings) {
    const name = warning.slice(
      0,
      warning.indexOf(":") < 0 ? undefined : warning.indexOf(":"),
    );
    reasons[name] = (reasons[name] ?? 0) + 1;
  }
  const median = (a: number[]) =>
    [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
  const report = {
    id: entry.id,
    tiers,
    tier2,
    reasons,
    warnings: imported.warnings,
    idempotent,
    equivalent:
      same &&
      !original.error &&
      !fresh.error &&
      !original.opaqueValues &&
      !fresh.opaqueValues,
    matchingProjection: same,
    originalError: original.error,
    freshError: fresh.error,
    opaqueValues: original.opaqueValues || fresh.opaqueValues,
    originalEvents: original.events.length,
    freshEvents: fresh.events.length,
    importMs: median(importTimes),
    generateMs: median(generateTimes),
    importTimes,
    generateTimes,
  };
  reports.push(report);
  if (!idempotent)
    await writeFile(
      new URL(`out/${entry.id}.idempotence.json`, import.meta.url),
      JSON.stringify(
        {
          original: JSON.parse(documentIdentity(imported.doc)),
          reimported: JSON.parse(documentIdentity(reimported.doc)),
        },
        null,
        2,
      ),
    );
  if (!same)
    await writeFile(
      new URL(`out/${entry.id}.events.json`, import.meta.url),
      JSON.stringify({ original, fresh }, null, 2),
    );
  console.log(
    `${entry.id}: ${report.equivalent ? "equal" : same ? "matching failure/opaque" : "DIFFERENT"}, idempotent=${idempotent}`,
  );
}
await writeFile(
  new URL("results.json", import.meta.url),
  JSON.stringify(
    {
      node: process.version,
      window: [0, 16],
      date: new Date().toISOString(),
      reports,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  stable({
    programs: reports.length,
    equal: reports.filter((r) => r.equivalent).length,
    idempotent: reports.filter((r) => r.idempotent).length,
    failures: reports
      .filter((r) => !r.equivalent)
      .map((r) => ({
        id: r.id,
        original: r.originalError,
        fresh: r.freshError,
        opaque: r.opaqueValues,
      })),
  }),
);

await writeTimings(reports);
const expected = new Set([
  "micro-bare-strings",
  "micro-query-throws",
  "micro-query-late-throws",
]);
const unexpected = reports.filter(
  (r) =>
    !r.idempotent ||
    !r.matchingProjection ||
    (!r.equivalent && !expected.has(r.id)),
);
if (unexpected.length)
  throw Error(
    `Unexpected corpus failures: ${unexpected.map((r) => r.id).join(", ")}`,
  );
