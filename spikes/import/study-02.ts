import { readFile, writeFile } from "node:fs/promises";
import { importStrudel, generate, queryEvents } from "./src/index.ts";
import { eventIdentity, documentIdentity } from "./src/compare.ts";
const entries: { id: string; file: string; title: string; origin: string }[] =
  JSON.parse(
    await readFile(new URL("../../corpus/index.json", import.meta.url), "utf8"),
  );
const reports = [];
const localPath =
  "/home/aaron/projects/monkeyboys-modular-synth/src/library/patches/switch-angel-trance-demo.strudel";
let external = "";
try {
  external = await readFile(localPath, "utf8");
} catch {}
for (const entry of [
  ...entries.filter((e) => e.origin === "owner-collected"),
  ...(external
    ? [
        {
          id: "local-switch-angel",
          file: localPath,
          title: "Switch Angel trance demo (local only)",
          origin: "local-only",
        },
      ]
    : []),
]) {
  const local = entry.origin === "local-only";
  const source = local
    ? external
    : await readFile(
        new URL("../../corpus/" + entry.file, import.meta.url),
        "utf8",
      );
  const imported = importStrudel(source),
    fresh = generate(imported.doc);
  const [original, result] = await Promise.all([
    queryEvents(source, 0, 17),
    queryEvents(fresh, 0, 17),
  ]);
  const tiers: Record<string, number> = { "1": 0, "2": 0, "3": 0 },
    tier2: Record<string, number> = {};
  const tier3: { fragment: string; reason: string }[] = [];
  function walk(x: unknown, parent?: unknown): void {
    if (!x || typeof x !== "object") return;
    if (
      "tier" in x &&
      typeof x.tier === "number" &&
      !("muted" in x) &&
      !("kind" in x && x.kind === "settings")
    ) {
      tiers[x.tier]++;
      if (x.tier === 2) {
        const name =
          "name" in x
            ? String(x.name)
            : "core" in x &&
                x.core &&
                typeof x.core === "object" &&
                "name" in x.core
              ? String(x.core.name)
              : "unknown";
        tier2[name] = (tier2[name] ?? 0) + 1;
      }
    }
    if ("kind" in x && x.kind === "literal") tiers["1"]++;
    if (
      "kind" in x &&
      x.kind === "opaque" &&
      !("tier" in x) &&
      !(
        parent &&
        typeof parent === "object" &&
        "core" in parent &&
        parent.core === x
      )
    )
      tiers["3"]++;
    for (const child of Object.values(x))
      if (child && typeof child === "object") walk(child, x);
  }
  walk(imported.doc);
  for (const warning of imported.warnings) {
    const at = warning.indexOf(":");
    tier3.push({
      fragment: local
        ? "register " +
          (warning.match(/register\(\s*['"]([^'"]+)/)?.[1] ??
            "[local fragment]") +
          " · local source line " +
          source
            .slice(0, source.indexOf(warning.slice(at + 1).trim()))
            .split("\n").length
        : warning.slice(at + 1).trim(),
      reason: warning.slice(0, at),
    });
  }
  reports.push({
    id: entry.id,
    title: entry.title,
    localOnly: local,
    path: local ? localPath : entry.file,
    evaluates: !original.error,
    equivalent:
      eventIdentity(original) === eventIdentity(result) &&
      !original.error &&
      !result.error &&
      !original.opaqueValues &&
      !result.opaqueValues,
    matchingProjection: eventIdentity(original) === eventIdentity(result),
    idempotent:
      documentIdentity(imported.doc) ===
      documentIdentity(importStrudel(fresh).doc),
    originalError: original.error,
    freshError: result.error,
    events: original.events.length,
    tiers,
    tier2,
    tier3,
    warnings: local
      ? imported.warnings.map((w) => w.split(":")[0] + ": [local source]")
      : imported.warnings,
  });
}
await writeFile(
  new URL("study-02-results.json", import.meta.url),
  JSON.stringify(
    { window: [0, 17], cyclesInclusive: [0, 16], reports },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    reports.map(({ id, evaluates, equivalent, originalError, tiers }) => ({
      id,
      evaluates,
      equivalent,
      originalError,
      tiers,
    })),
    null,
    2,
  ),
);
