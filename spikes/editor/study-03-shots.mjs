import { chromium } from "@playwright/test";
import { preview } from "vite";
import { freePort } from "./serve.mjs";
import {
  existsSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
const round = process.env.ROUND || "round1",
  start = performance.now();
const server = await preview({
  preview: { host: "127.0.0.1", port: await freePort(), strictPort: true },
});
const executablePath = readdirSync(`${homedir()}/.cache/ms-playwright`)
  .filter((x) => /^chromium-\d+$/.test(x))
  .sort()
  .reverse()
  .map((x) => `${homedir()}/.cache/ms-playwright/${x}/chrome-linux64/chrome`)
  .find(existsSync);
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  records = [];
page.on("pageerror", (e) => errors.push(String(e)));
mkdirSync("shots/v3", { recursive: true });
try {
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(
    () => window.editorStudy && !window.editorStudy.busy,
  );
  for (const id of [
    "real-techno",
    "real-house-vocals",
    "real-dnb-arranged",
    "real-dubstep-arranged",
    "switch-angel",
    "micro-orbit-conflict",
    "twenty",
  ]) {
    if (process.env.ONLY && !process.env.ONLY.split(",").includes(id)) continue;
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
      await page.getByRole("button", { name: "Done ×", exact: true }).click();
    } else await page.evaluate((id) => window.editorStudy.setCorpus(id), id);
    await page
      .getByRole("button", { name: "◎ Constellation", exact: true })
      .click();
    for (const level of ["far", "middle", "near"]) {
      if (round === "before") {
        await page.getByRole("button", { name: "Fit", exact: true }).click();
        for (
          let i = 0;
          i < (level === "far" ? 5 : level === "near" ? 0 : 2);
          i++
        )
          await page
            .getByRole("button", { name: "Zoom out", exact: true })
            .click();
      } else
        await page
          .getByRole("button", {
            name:
              level === "far" ? "Far" : level === "middle" ? "Middle" : "Near",
            exact: true,
          })
          .click();
      await page.waitForTimeout(700);
      await page.screenshot({
        path: `shots/v3/${round}-${id}-${level}.jpg`,
        type: "jpeg",
        quality: 48,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    if (round !== "before")
      for (const level of ["far", "middle", "near"]) {
        await page
          .getByRole("button", {
            name:
              level === "far" ? "Far" : level === "middle" ? "Middle" : "Near",
            exact: true,
          })
          .click();
        await page.waitForTimeout(650);
        await page.screenshot({
          path: `shots/v3/${round}-${id}-phone-${level}.jpg`,
          type: "jpeg",
          quality: 45,
        });
      }
    else
      await page.screenshot({
        path: `shots/v3/${round}-${id}-phone.jpg`,
        type: "jpeg",
        quality: 45,
      });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("button", { name: "▤ Score sheet", exact: true })
      .click();
    const selection = await page.evaluate(
      () =>
        window.editorStudy.targets.find((t) => t.setting)?.id ||
        window.editorStudy.targets[0].id,
    );
    await page.evaluate((id) => window.editorStudy.choose(id), selection);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `shots/v3/${round}-${id}-inset.jpg`,
      type: "jpeg",
      quality: 48,
    });
    if (round !== "before") {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: `shots/v3/${round}-${id}-phone-inset.jpg`,
        type: "jpeg",
        quality: 45,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    records.push({
      id,
      errors: await page.evaluate(() => window.editorStudy.errors),
    });
    await page.getByRole("button", { name: "Done ×", exact: true }).click();
  }
  writeFileSync(
    `study-03-${round}.json`,
    JSON.stringify(
      { durationMs: performance.now() - start, errors, records },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ round, durationMs: performance.now() - start, errors }),
  );
} finally {
  await browser.close();
  await server.httpServer.close();
}
