import { chromium } from "@playwright/test";
import { preview } from "vite";
import { freePort } from "./serve.mjs";
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import assert from "node:assert/strict";
const start = performance.now(),
  pass = process.env.PASS || "final";
const server = await preview({
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
  executablePath: existsSync(chromium.executablePath()) ? undefined : installed,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await ctx.newPage(),
  errors = [],
  checks = [],
  shots = [];
page.on("pageerror", (e) => errors.push(String(e)));
const watchdog = setTimeout(() => browser.close(), 85000);
mkdirSync("shots", { recursive: true });
const ready = () =>
  page.waitForFunction(
    () =>
      window.editorStudy &&
      !window.editorStudy.busy &&
      Object.keys(window.editorStudy.events).length > 0,
  );
async function fixture(id) {
  await page.evaluate((id) => window.editorStudy.setFixture(id), id);
  await ready();
}
async function pick(label, voice = 0) {
  return page.evaluate(
    ({ label, voice }) => {
      const s = window.editorStudy;
      const v = s.document.voices[voice];
      const t = s.targets.find(
        (t) =>
          t.voice.id === v.id &&
          (t.label === label || t.path.join(" › ") === label),
      );
      if (!t) throw Error("Missing " + label);
      return s.choose(t.id);
    },
    { label, voice },
  );
}
async function shot(name) {
  if (pass === "study02") return; // Study 02 captures real pieces with shots:v2.
  const path = `shots/${pass}-${name}.jpg`;
  await page.screenshot({ path, quality: 63, fullPage: false, type: "jpeg" });
  shots.push(path);
}
async function done() {
  await page.getByRole("button", { name: "Done ×" }).click();
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await ready();
  for (const [id, n] of [
    ["three", 3],
    ["eight", 8],
    ["twenty", 20],
  ]) {
    await fixture(id);
    await page
      .getByRole("button", { name: "◎ Constellation", exact: true })
      .click();
    await shot(`constellation-${n}`);
    await page
      .getByRole("button", { name: "▤ Score sheet", exact: true })
      .click();
    await shot(`sheet-${n}`);
    assert.equal(await page.locator("tbody tr").count(), n);
    checks.push(`sheet ${n} voices`);
    for (const [label, kind] of [
      ["typed sequence", "typed"],
      ["gain", "constant"],
      ["lpf", "signal"],
      ["fast", "rewrite"],
    ]) {
      await pick(label);
      await shot(`editor-${kind}-${n}`);
      assert(await page.locator("#breadcrumb").textContent());
      await done();
    }
  }
  await fixture("rhythms");
  await pick("bass", 1);
  await shot("editor-rule");
  assert.match(await page.locator(".notice").textContent(), /cannot be moved/);
  await done();
  await pick("source · not modelled", 2);
  await shot("editor-source");
  await page.locator("#opaque-code").fill("not valid code }");
  await page
    .locator(".error-box")
    .first()
    .waitFor({ state: "visible", timeout: 3000 });
  assert(await page.locator(".error-box").count());
  await shot("editor-source-broken");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready();
  assert.equal(
    Object.keys(await page.evaluate(() => window.editorStudy.errors)).length,
    0,
    JSON.stringify(await page.evaluate(() => window.editorStudy.errors)),
  );
  await done();
  checks.push("broken source + undo");
  await fixture("nested");
  const tier2 = await page.evaluate(
    () => window.editorStudy.targets.find((t) => t.node.tier === 2).id,
  );
  await page.evaluate((id) => window.editorStudy.choose(id), tier2);
  await shot("editor-tier2");
  await done();
  await page
    .getByRole("button", { name: "◎ Constellation", exact: true })
    .click();
  await shot("nested-constellation");
  await fixture("twenty");
  await page.locator("#find").fill("shore lpf");
  await page.getByRole("button", { name: "shore › lpf", exact: true }).click();
  assert.equal(await page.locator("#breadcrumb").textContent(), "shore › lpf");
  const selected = await page.evaluate(() => window.editorStudy.selected);
  await page
    .getByRole("button", { name: "◎ Constellation", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.editorStudy.selected),
    selected,
  );
  checks.push(
    "20-voice lookup: focus + type + click = 3 actions; selection survives map switch",
  );
  await done();
  await fixture("three");
  await pick("typed sequence");
  const old = await page.evaluate(() => window.editorStudy.source);
  await page
    .getByRole("button", { name: "Split into sub-group", exact: true })
    .click();
  await ready();
  assert.notEqual(await page.evaluate(() => window.editorStudy.source), old);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready();
  assert.equal(await page.evaluate(() => window.editorStudy.source), old);
  await done();
  checks.push("split document/generation + undo");
  await pick("gain");
  await page.locator("#constant-value").fill("0.6");
  await page.locator("#constant-value").press("Tab");
  await ready();
  assert(
    (
      await page.evaluate(() => Object.values(window.editorStudy.events).flat())
    ).some((e) => e.value.gain === 0.6),
  );
  checks.push("constant edit changes real events");
  await done();
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await page.waitForFunction(() => window.editorStudy.engine.playing);
  await pick("gain");
  await page.locator("#constant-value").fill("0.4");
  await page.locator("#constant-value").press("Tab");
  await ready();
  await shot("pending-live-edit");
  await page.waitForFunction(
    () => window.editorStudy.changeLog.some((x) => x.state === "landed"),
    undefined,
    { timeout: 7000 },
  );
  const dispatches = await page.evaluate(
    () => window.editorStudy.engine.dispatches,
  );
  assert(dispatches.length > 0);
  checks.push("live swap + pending lands on dispatched changed revision");
  await page.locator("#apply-mode").selectOption("next");
  await page.locator("#constant-value").fill("0.45");
  await page.locator("#constant-value").press("Tab");
  await ready();
  const boundary = await page.evaluate(() => window.editorStudy.pending?.first);
  assert(Number.isInteger(boundary));
  await page.waitForFunction(() => !window.editorStudy.pending, undefined, {
    timeout: 7000,
  });
  checks.push("next uncommitted cycle swap lands on changed onset");
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  await done();

  await fixture("three");
  await page
    .getByRole("button", { name: "▤ Score sheet", exact: true })
    .click();
  const first = page.locator("tbody tr").first();
  await first.getByTitle("Mute lead").click();
  await ready();
  assert(await first.evaluate((el) => el.classList.contains("muted")));
  await first.getByTitle("Mute lead").click();
  await ready();
  await first
    .getByRole("button", { name: "Collapse lead", exact: true })
    .click();
  assert.equal(await first.locator(".lane").count(), 0);
  checks.push("mute + collapse row");
  await pick("lpf");
  await page
    .getByRole("button", { name: "signal › open driver", exact: true })
    .click();
  await page.locator('[data-signal="0"]').fill("450");
  await page.locator('[data-signal="0"]').press("Tab");
  await ready();
  assert.match(
    await page.evaluate(() => window.editorStudy.source),
    /range\(450/,
  );
  await done();
  checks.push("signal handles regenerate");
  await pick("gain");
  await page.getByRole("button", { name: "+ Setting", exact: true }).click();
  await page.locator("#add-search").fill("crush");
  await page
    .getByRole("button", { name: "crush · common", exact: true })
    .click();
  await ready();
  assert.match(await page.evaluate(() => window.editorStudy.source), /crush/);
  await done();
  checks.push("registry setting add");
  for (const [id, n] of [
    ["three", 3],
    ["eight", 8],
    ["twenty", 20],
  ]) {
    await fixture(id);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "◎ Constellation", exact: true })
      .click();
    await shot(`phone-constellation-${n}`);
    await page
      .getByRole("button", { name: "▤ Score sheet", exact: true })
      .click();
    await shot(`phone-sheet-${n}`);
    for (const [label, kind] of [
      ["typed sequence", "typed"],
      ["gain", "constant"],
      ["lpf", "signal"],
      ["fast", "rewrite"],
    ]) {
      await pick(label);
      await shot(`phone-editor-${kind}-${n}`);
      assert(await page.getByRole("button", { name: "Done ×" }).isVisible());
      await done();
    }
  }
  await fixture("rhythms");
  await pick("bass", 1);
  await shot("phone-editor-rule");
  await done();
  await pick("source · not modelled", 2);
  await shot("phone-editor-source");
  await done();
  await fixture("nested");
  const id = await page.evaluate(
    () => window.editorStudy.targets.find((t) => t.node.tier === 2).id,
  );
  await page.evaluate((id) => window.editorStudy.choose(id), id);
  await shot("phone-editor-tier2");

  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const n of [3, 8, 20]) {
    await page.evaluate((n) => window.editorStudy.setStudy(n), n);
    await ready();
    await pick("bass", 1);
    await shot(`editor-rule-${n}`);
    await done();
    await pick("source · not modelled", 2);
    await shot(`editor-source-${n}`);
    await done();
    const t = await page.evaluate(
      () => window.editorStudy.targets.find((t) => t.node.tier === 2).id,
    );
    await page.evaluate((id) => window.editorStudy.choose(id), t);
    await shot(`editor-tier2-${n}`);
    await done();
    await page.setViewportSize({ width: 390, height: 844 });
    await pick("bass", 1);
    await shot(`phone-editor-rule-${n}`);
    await done();
    await pick("source · not modelled", 2);
    await shot(`phone-editor-source-${n}`);
    await done();
    await page.evaluate((id) => window.editorStudy.choose(id), t);
    await shot(`phone-editor-tier2-${n}`);
    await done();
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  for (const [id, n] of [
    ["three", 3],
    ["eight", 8],
    ["twenty", 20],
  ]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await fixture(id);
    await pick("lpf", 1);
    await shot(`editor-stepped-${n}`);
    await done();
    await page.setViewportSize({ width: 390, height: 844 });
    await pick("lpf", 1);
    await shot(`phone-editor-stepped-${n}`);
    await done();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    `browser-results-${pass}.json`,
    JSON.stringify(
      {
        durationMs: performance.now() - start,
        checks,
        errors,
        shots,
        dispatches: dispatches.slice(-8),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      pass,
      durationMs: performance.now() - start,
      checks: checks.length,
      shots: shots.length,
      errors,
    }),
  );
} finally {
  clearTimeout(watchdog);
  await browser.close();
  await server.httpServer.close();
}
