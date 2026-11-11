import { chromium } from "@playwright/test";
import { preview } from "vite";
import { freePort } from "./serve.mjs";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import assert from "node:assert/strict";
const start = performance.now(),
  checks = [],
  failures = [];
const server = await preview({
  build: { outDir: process.env.BEFORE ? "owner-baseline-dist" : "dist" },
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
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const check = (name, fn) => {
  try {
    fn();
    checks.push(name);
  } catch (e) {
    failures.push({ name, error: String(e) });
  }
};
try {
  // Only query delivery is slowed; the real importer, Strudel worker and UI run.
  await page.addInitScript(() => {
    const Base = window.Worker;
    window.Worker = class extends Base {
      postMessage(...args) {
        setTimeout(() => super.postMessage(...args), 250);
      }
    };
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(
    () => window.editorStudy && !window.editorStudy.busy,
  );
  await page.evaluate(() => window.editorStudy.engine.init());
  const registry = await page.evaluate(() =>
    Object.fromEntries(
      ["bd", "hh", "cp"].map((s) => [
        s,
        !!window.editorStudy.engine.web.getSound(s),
      ]),
    ),
  );
  const online = await page.evaluate(() =>
    fetch(
      "https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json",
      { signal: AbortSignal.timeout(3000) },
    )
      .then((r) => r.ok)
      .catch(() => false),
  );
  if (online)
    check("documented default drums are registered after initialization", () =>
      assert.deepEqual(registry, { bd: true, hh: true, cp: true }),
    );
  else checks.push("default sample registration not checked: offline");
  await page.locator("#piece").selectOption("real-techno");
  // Capture the actual named row receiving the owner's click while query is pending.
  const displayed = await page
    .locator("tbody tr:nth-child(2) .name")
    .textContent();
  check(
    "new document replaces old clickable rows before a slow query returns",
    () => assert.equal(displayed, "hi-hat"),
  );
  await page.locator('tbody tr:nth-child(2) [data-action="mute"]').click();
  await page.waitForFunction(() => !window.editorStudy.busy);
  const state = await page.evaluate(() => ({
    rows: [...document.querySelectorAll("tbody tr")].map((r) => ({
      id: r.dataset.instrument,
      name: r.querySelector(".name").textContent,
      muted: r.classList.contains("muted"),
    })),
    source: window.editorStudy.source,
    preview: Object.values(window.editorStudy.events)
      .flat()
      .map((e) => e.value.s),
  }));
  check("real pointer mute affects the displayed hi-hat and no other row", () =>
    assert.deepEqual(
      state.rows.filter((r) => r.muted).map((r) => r.name),
      ["hi-hat"],
    ),
  );
  check("mute never destroys another instrument's scored events", () =>
    assert(state.preview.includes("bd"), JSON.stringify(state)),
  );
  await page.locator('[data-action="map-a"]').click();
  const planets = await page.locator(".planet-state").allTextContents();
  check("Constellation agrees with the muted hi-hat row", () =>
    assert(planets[1].includes("Muted"), JSON.stringify(planets)),
  );
  writeFileSync(
    process.env.BEFORE
      ? "owner-regressions-before.json"
      : "owner-regressions.json",
    JSON.stringify(
      {
        durationMs: performance.now() - start,
        registry,
        displayed,
        state,
        planets,
        checks,
        failures,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ durationMs: performance.now() - start, checks, failures }),
  );
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await server.httpServer.close();
}
