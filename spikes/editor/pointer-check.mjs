import { chromium } from "@playwright/test";
import { preview } from "vite";
import { freePort } from "./serve.mjs";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import assert from "node:assert/strict";
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
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } }),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(String(e)));
const timer = setTimeout(() => browser.close(), 20000);
const ready = () =>
  page.waitForFunction(
    () =>
      window.editorStudy &&
      !window.editorStudy.busy &&
      Object.keys(window.editorStudy.events).length > 0,
  );
async function choose(label, voice = 0) {
  await page.evaluate(
    ({ label, voice }) => {
      const s = window.editorStudy,
        t = s.targets.find(
          (t) =>
            t.voice.id === s.document.voices[voice].id && t.label === label,
        );
      return s.choose(t.id);
    },
    { label, voice },
  );
}
try {
  await page.goto(`http://localhost:${server.httpServer.address().port}`);
  await ready();
  await page.evaluate(() => window.editorStudy.setFixture("three"));
  await ready();
  await page
    .getByRole("button", { name: "◎ Constellation", exact: true })
    .click();
  await choose("lpf", 1);
  const before = await page.evaluate(() => window.editorStudy.source),
    box = await page.locator("#paint-lane").boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, {
    steps: 8,
  });
  await page.mouse.up();
  await ready();
  assert.notEqual(await page.evaluate(() => window.editorStudy.source), before);
  const painted = await page.evaluate(() =>
    window.editorStudy.document.voices[1].pattern.layers
      .flatMap((l) => (l.kind === "settings" ? l.settings : []))
      .find((s) => s.name === "lpf")
      .value.core.steps.map((s) => s.value),
  );
  assert.notEqual(painted[0], "600");
  assert.notEqual(painted[1], "2200");
  checks.push("pointer painting changes weighted stepped setting");
  await page.getByRole("button", { name: "Done ×" }).click();
  await choose("lpf");
  await page
    .getByRole("button", { name: "signal › open driver", exact: true })
    .click();
  await ready();
  const low = await page.locator('[data-signal="0"]').inputValue(),
    handle = await page
      .getByRole("button", { name: "Drag lowest value" })
      .boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2 - 14,
    { steps: 4 },
  );
  await page.mouse.up();
  await ready();
  assert(
    Number(await page.locator('[data-signal="0"]').inputValue()) > Number(low),
  );
  await page.screenshot({
    path:
      process.env.PASS === "study02"
        ? "shots/v2/after-wave-handle.jpg"
        : "shots/pointer-wave-handle.jpg",
    type: "jpeg",
    quality: 63,
  });
  checks.push("direct wave handle drag changes signal range");
  assert(await page.locator(".navigator").evaluate((el) => el.inert));
  assert(await page.locator(".map-container").evaluate((el) => el.inert));
  checks.push("map and navigator locked while editor open");
  await page.getByRole("button", { name: "Done ×" }).click();
  const universe = await page.locator("#universe").getAttribute("style"),
    space = await page.locator("#space").boundingBox();
  await page.mouse.move(space.x + 10, space.y + 10);
  await page.mouse.down();
  await page.mouse.move(space.x + 55, space.y + 40, { steps: 4 });
  await page.mouse.up();
  assert.notEqual(
    await page.locator("#universe").getAttribute("style"),
    universe,
  );
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  assert.match(
    await page.locator("#universe").getAttribute("style"),
    /translate\(0px,0px\)/,
  );
  checks.push("pan and Fit recover camera");
  assert.deepEqual(errors, []);
  const result = {
    durationMs: performance.now() - started,
    checks,
    errors,
    painted,
  };
  writeFileSync("pointer-results.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  clearTimeout(timer);
  await browser.close();
  await server.httpServer.close();
}
