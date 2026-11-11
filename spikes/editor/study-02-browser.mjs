import { chromium } from "@playwright/test";
import { preview } from "vite";
import { freePort } from "./serve.mjs";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import assert from "node:assert/strict";
const start = performance.now(),
  round = process.env.ROUND || "after";
const server = await preview({
  preview: { host: "127.0.0.1", port: await freePort(), strictPort: true },
});
const installed = readdirSync(`${homedir()}/.cache/ms-playwright`)
  .filter((x) => /^chromium-\d+$/.test(x))
  .sort()
  .reverse()
  .map((x) => `${homedir()}/.cache/ms-playwright/${x}/chrome-linux64/chrome`)
  .find(existsSync);
const browser = await chromium.launch({
  headless: true,
  executablePath: existsSync(chromium.executablePath()) ? undefined : installed,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  observations = [];
page.on("pageerror", (e) => errors.push(String(e)));
const timer = setTimeout(() => browser.close(), 85000);
mkdirSync("shots/v2", { recursive: true });
const ready = () =>
  page.waitForFunction(() => window.editorStudy && !window.editorStudy.busy);
try {
  await page.goto(server.resolvedUrls.local[0]);
  await ready();
  for (const id of [
    "real-house",
    "real-techno",
    "real-house-vocals",
    "real-dnb-arranged",
    "switch-angel",
    "twenty",
  ]) {
    if (process.env.ONLY && process.env.ONLY !== id) continue;
    if (id === "twenty")
      await page.evaluate(() => window.editorStudy.setFixture("twenty"));
    else if (id === "switch-angel") {
      const path =
        "/home/aaron/projects/monkeyboys-modular-synth/src/library/patches/switch-angel-trance-demo.strudel";
      if (!existsSync(path)) continue;
      await page
        .getByRole("button", { name: "Paste Strudel…", exact: true })
        .click();
      await page.locator("#paste-source").fill(readFileSync(path, "utf8"));
      await page
        .getByRole("button", { name: "Import expression", exact: true })
        .click();
    } else await page.evaluate((id) => window.editorStudy.setCorpus(id), id);
    await ready();
    if (
      await page
        .getByRole("button", { name: "Done ×", exact: true })
        .isVisible()
    )
      await page.getByRole("button", { name: "Done ×", exact: true }).click();
    for (const map of ["sheet", "constellation"]) {
      await page
        .getByRole("button", {
          name: map === "sheet" ? "▤ Score sheet" : "◎ Constellation",
          exact: true,
        })
        .click();
      await page.screenshot({
        path: `shots/v2/${round}-${id}-${map}.jpg`,
        type: "jpeg",
        quality: 65,
      });
      if (round === "after")
        assert.deepEqual(
          await page.evaluate(() => window.editorStudy.errors),
          {},
          id + " query",
        );
      observations.push({
        id,
        map,
        rows: await page.locator("tbody tr").count(),
        names: await page.locator(".voice-name").allTextContents(),
        broken: await page.evaluate(() => window.editorStudy.errors),
      });
    }
    if (
      round !== "before" &&
      (id.includes("arranged") || id === "real-house-vocals")
    ) {
      await page.locator('[data-action="jump-section"]').nth(2).click();
      await ready();
      for (const map of ["sheet", "constellation"]) {
        await page
          .getByRole("button", {
            name: map === "sheet" ? "▤ Score sheet" : "◎ Constellation",
            exact: true,
          })
          .click();
        await page.screenshot({
          path: `shots/v2/${round}-${id}-drop-${map}.jpg`,
          type: "jpeg",
          quality: 65,
        });
      }
      if (round === "after")
        assert.equal(
          await page
            .locator('[aria-current="step"]')
            .textContent()
            .then((t) => t.includes("drop")),
          true,
        );
      await page.locator(".arrangement").screenshot({
        path: `shots/v2/${round}-${id}-arrangement.jpg`,
        type: "jpeg",
        quality: 75,
      });
    }
  }
  writeFileSync(
    `study-02-${round}${process.env.ONLY ? "-" + process.env.ONLY : ""}.json`,
    JSON.stringify(
      { durationMs: performance.now() - start, errors, observations },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ round, durationMs: performance.now() - start, errors }),
  );
} finally {
  clearTimeout(timer);
  await browser.close();
  await server.httpServer.close();
}
