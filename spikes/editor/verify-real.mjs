import { chromium } from "@playwright/test";
import { preview } from "vite";
import { freePort } from "./serve.mjs";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import assert from "node:assert/strict";
import { switchAngelPath } from "./local-source.mjs";
const start = performance.now(),
  checks = [],
  errors = [];
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
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => errors.push(String(e)));
page.setDefaultTimeout(10000);
const timer = setTimeout(() => browser.close(), 80000);
const ready = () =>
  page.waitForFunction(() => window.editorStudy && !window.editorStudy.busy);
const done = () =>
  page.getByRole("button", { name: "Done ×", exact: true }).click();
const jump = async (n) => {
  await page.locator('.sections [data-action="jump-section"]').nth(n).click();
  await ready();
};
try {
  await page.goto(server.resolvedUrls.local[0]);
  await ready();
  await page.evaluate(() => window.editorStudy.setCorpus("real-house-vocals"));
  await ready();
  await page
    .getByRole("button", { name: "▤ Score sheet", exact: true })
    .click();
  assert.equal(await page.locator("tbody tr").count(), 8);
  assert.equal(await page.locator("tbody tr:not(.inactive)").count(), 2);
  assert(
    (await page.locator("tbody tr.inactive").first().textContent()).includes(
      "Not in this section",
    ),
  );
  const heights = await page
    .locator("tbody tr")
    .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
  assert(
    Math.max(...heights) - Math.min(...heights) < 3,
    JSON.stringify(heights),
  );
  const initial = await page.evaluate(() => window.editorStudy.source);
  await page.evaluate(() => {
    const s = window.editorStudy,
      id = s.document.shared.chords.layers
        .flatMap((l) => (l.kind === "settings" ? l.settings : []))
        .find((x) => x.name === "delay").id;
    return s.choose(id);
  });
  assert(
    (await page.locator(".sharing-notice").textContent()).includes(
      "One shared instrument",
    ),
  );
  await page.screenshot({
    path: "shots/v2/after-shared-editor.jpg",
    quality: 65,
    type: "jpeg",
  });
  await page.locator("#constant-value").fill("0.5");
  await page.locator("#constant-value").press("Tab");
  await ready();
  await done();
  for (const n of [0, 1, 2, 3, 4]) {
    await jump(n);
    const delay = await page.evaluate(() => {
      const s = window.editorStudy;
      return Object.values(s.events)
        .flat()
        .filter((e) => e.value.__planet === s.document.shared.chords.id)
        .map((e) => e.value.delay);
    });
    assert(delay.length > 0);
    assert(delay.every((x) => x === 0.5));
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready();
  assert.equal(await page.evaluate(() => window.editorStudy.source), initial);
  checks.push(
    "one chords definition edited across all five sections; undo restores it",
  );
  await page.getByRole("button", { name: /more settings/ }).click();
  assert(
    await page
      .locator("thead")
      .textContent()
      .then((t) => t.includes("speed")),
  );
  checks.push("rare settings unfold; rows retain a consistent height");
  await page.locator("#find").fill("chords filter");
  assert((await page.locator(".result").count()) > 0);
  await page.locator(".result").first().click();
  await ready();
  assert(!(await page.locator("#breadcrumb").textContent()).includes("$"));
  await done();
  checks.push(
    "author names and human setting names work in search and breadcrumbs",
  );
  await page.locator("#find").fill("");
  await jump(2);
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await page.waitForFunction(() =>
    window.editorStudy.engine.dispatches.some((x) => x.begin >= 8),
  );
  assert(await page.evaluate(() => window.editorStudy.engine.phase() >= 8));
  await jump(0);
  assert.equal(
    await page
      .locator('[aria-current="step"]')
      .textContent()
      .then((t) => t.includes("intro")),
    true,
  );
  await page.waitForFunction(
    () =>
      window.editorStudy.engine.playing &&
      window.editorStudy.engine.phase() < 4,
  );
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  checks.push(
    "Play starts at the selected section; jumping while playing restarts at the selected cycle (dispatch and phase observed only)",
  );
  if (existsSync(switchAngelPath)) {
    await page
      .getByRole("button", { name: "Switch Angel · local file", exact: true })
      .click();
    await ready();
    assert.deepEqual(await page.evaluate(() => window.editorStudy.errors), {});
    assert.equal(await page.locator("tbody tr").count(), 4);
    checks.push(
      "local-only Switch Angel file loads through the runtime endpoint without redistribution",
    );
  } else checks.push("Switch Angel absent; local-only input skipped");
  assert.deepEqual(errors, []);
  writeFileSync(
    "real-browser-results.json",
    JSON.stringify(
      { durationMs: performance.now() - start, checks, errors, heights },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ durationMs: performance.now() - start, checks, errors }),
  );
} catch (error) {
  console.log(
    JSON.stringify(
      await page.evaluate(() => ({
        phase: window.editorStudy.engine.phase(),
        playing: window.editorStudy.engine.playing,
        clock: document.querySelector("#clock")?.textContent,
        current: document.querySelector("[aria-current=step]")?.textContent,
        dispatch: window.editorStudy.engine.dispatches.slice(-3),
        scheduler: ((s) => ({
          lastEnd: s.lastEnd,
          seconds: s.seconds_at_cps_change,
          cycles: s.num_cycles_at_cps_change,
        }))(window.editorStudy.engine.repl.scheduler),
      })),
      null,
      2,
    ),
  );
  throw error;
} finally {
  clearTimeout(timer);
  await browser.close();
  await server.httpServer.close();
}
