import { chromium } from "@playwright/test";
import { preview } from "vite";
import { freePort } from "./serve.mjs";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const started = performance.now(),
  server = await preview({
    preview: { host: "127.0.0.1", port: await freePort(), strictPort: true },
  });
const cache = `${homedir()}/.cache/ms-playwright`,
  installed = readdirSync(cache)
    .filter((s) => /^chromium-\d+$/.test(s))
    .sort()
    .reverse()
    .map((s) => `${cache}/${s}/chrome-linux64/chrome`)
    .find(existsSync);
const browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(chromium.executablePath())
      ? undefined
      : installed,
  }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  rows = [];
page.on("pageerror", (e) => errors.push(String(e)));
const timer = setTimeout(() => browser.close(), 85000);
try {
  await page.goto(`http://localhost:${server.httpServer.address().port}`);
  await page.waitForFunction(
    () => window.editorStudy && !window.editorStudy.busy,
  );
  const ids = await page.evaluate(() => window.editorStudy.corpus);
  for (const id of ids) {
    await page.evaluate((id) => window.editorStudy.setCorpus(id), id);
    const record = await page.evaluate(() => {
      const s = window.editorStudy,
        ids = [],
        walk = (x) => {
          if (!x || typeof x !== "object") return;
          if ("id" in x && "tier" in x) ids.push(x.id);
          for (const v of Object.values(x))
            if (typeof v === "object")
              Array.isArray(v) ? v.forEach(walk) : walk(v);
        };
      walk(s.document);
      return {
        voices: s.document.voices.length,
        nodes: ids.length,
        unselectable: [...new Set(ids)].filter(
          (id) => !s.targets.some((t) => t.id === id),
        ),
        unlabelled: s.targets
          .filter((t) => !t.label || t.path.some((x) => !x))
          .map((t) => t.id),
        queryErrors: s.errors,
        events: Object.values(s.events).flat().length,
        opaque: s.targets.filter((t) => t.node.tier === 3).length,
      };
    });
    await page
      .getByRole("button", { name: "◎ Constellation", exact: true })
      .click();
    record.constellation = (await page.locator("#universe").count()) === 1;
    record.planets = await page.locator(".planet-face").count();
    const finite = await page.evaluate(
      () =>
        !document
          .querySelector("#universe")
          ?.innerHTML.match(/(?:="NaN|="Infinity)/),
    );
    record.finite = finite;
    await page
      .getByRole("button", { name: "▤ Score sheet", exact: true })
      .click();
    record.sheet = (await page.locator("tbody tr").count()) === record.planets;
    const rendered = await page.evaluate(() =>
      [...document.querySelectorAll("[data-id],[data-select]")].map(
        (x) => x.dataset.id ?? x.dataset.select,
      ),
    );
    record.rows = await page.locator("tbody tr").count();
    record.searchOnly = await page.evaluate(
      (rendered) =>
        window.editorStudy.targets
          .filter((t) => !rendered.includes(t.id))
          .map((t) => t.path.join(" › ")),
      rendered,
    );
    record.wrong = [];
    if (record.planets > 10)
      record.wrong.push("constellation: many planets require long scroll");
    if (record.opaque)
      record.wrong.push(
        "opaque source needs inspection; semantic layout is incomplete",
      );
    if (record.voices === 1 && record.planets > 1)
      record.wrong.push(
        "both: instrument rows include section rests; timing differs across cycles",
      );
    if (record.events > 128)
      record.wrong.push(
        "both: dense event glyphs need zoom; lane drawing caps at 400 parts",
      );
    if (Object.keys(record.queryErrors).length)
      record.wrong.push("both: BROKEN result shown for query failure");
    rows.push({ id, ...record });
    if (
      process.env.CAPTURE_AUDIT &&
      [
        "micro-callback-deep",
        "micro-dense-stack",
        "micro-tree-arrange",
        "micro-orbit-conflict",
        "micro-query-throws",
        "piece-glass-garden",
      ].includes(id)
    ) {
      await page.screenshot({
        path: `shots/corpus-${id}-sheet.jpg`,
        quality: 58,
      });
      await page
        .getByRole("button", { name: "◎ Constellation", exact: true })
        .click();
      await page.screenshot({
        path: `shots/corpus-${id}-constellation.jpg`,
        quality: 58,
      });
    }
  }
  const report = {
    durationMs: performance.now() - started,
    window: [0, 1],
    total: rows.length,
    consoleErrors: errors,
    rows,
  };
  writeFileSync("corpus-coverage.json", JSON.stringify(report, null, 2));
  writeFileSync(
    "CORPUS.md",
    "| Program | Constellation | Sheet | Unselectable / unlabelled | Observations |\n|---|---|---|---|---|\n" +
      rows
        .map(
          (r) =>
            `| ${r.id} | ${r.constellation && r.finite ? "renders" : "FAIL"} · ${r.planets} planets | ${r.sheet ? "renders" : "FAIL"} · ${r.rows} rows | ${r.unselectable.length} / ${r.unlabelled.length} | ${r.wrong.join("; ") || "No structural issue detected at cycle 0"} |`,
        )
        .join("\n") +
      "\n",
  );
  console.log(
    JSON.stringify({
      durationMs: report.durationMs,
      total: rows.length,
      mapFailures: rows
        .filter((r) => !r.constellation || !r.sheet || !r.finite)
        .map((r) => r.id),
      unselectable: rows
        .filter((r) => r.unselectable.length)
        .map((r) => ({ id: r.id, nodes: r.unselectable })),
      errors,
    }),
  );
} finally {
  clearTimeout(timer);
  await browser.close();
  await server.httpServer.close();
}
