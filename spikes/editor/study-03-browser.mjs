import { chromium } from "@playwright/test";
import { preview } from "vite";
import { freePort } from "./serve.mjs";
import { existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import assert from "node:assert/strict";
const start = performance.now(),
  checks = [],
  errors = [];
const server = await preview({
  preview: { host: "127.0.0.1", port: await freePort(), strictPort: true },
});
const executablePath = readdirSync(`${homedir()}/.cache/ms-playwright`)
  .filter((x) => /^chromium-\d+$/.test(x))
  .sort()
  .reverse()
  .map((x) => `${homedir()}/.cache/ms-playwright/${x}/chrome-linux64/chrome`)
  .find(existsSync);
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => errors.push(String(e)));
const ready = () =>
  page.waitForFunction(() => window.editorStudy && !window.editorStudy.busy);
try {
  await page.goto(server.resolvedUrls.local[0]);
  await ready();
  await page.evaluate(() => window.editorStudy.setFixture("twenty"));
  await page
    .getByRole("button", { name: "◎ Constellation", exact: true })
    .click();
  await page.getByRole("button", { name: "Far", exact: true }).click();
  assert.equal(await page.locator("#universe .planet-face").count(), 20);
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(550);
    const fits = await page.evaluate(() => {
      const area = document
        .querySelector(".map-container")
        .getBoundingClientRect();
      return (
        [...document.querySelectorAll("#universe .planet-face")].every((p) => {
          const b = p.getBoundingClientRect();
          return (
            b.left >= area.left &&
            b.right <= area.right &&
            b.top >= area.top &&
            b.bottom <= area.bottom
          );
        }) &&
        document.querySelector(".map-container").scrollHeight ===
          document.querySelector(".map-container").clientHeight
      );
    });
    assert(fits, JSON.stringify(viewport) + " all twenty fit");
  }
  checks.push(
    "twenty real planets fit far on desktop and phone, with no map scroll",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("[data-dive]").first().dblclick();
  assert.equal(await page.locator(".editor").count(), 0);
  assert.equal(
    await page.evaluate(() => window.editorStudy.visualState.detail),
    "near",
  );
  await page
    .getByRole("button", { name: "All instruments", exact: true })
    .click();
  assert.equal(await page.locator("#universe .planet-face").count(), 20);
  await page.locator("#find").fill("shore lpf");
  await page.locator(".result").first().click();
  await ready();
  assert.equal(await page.locator(".editor").count(), 1);
  assert.equal(
    await page.evaluate(
      () =>
        window.editorStudy.visualState.systems.find(
          (s) => s.id === window.editorStudy.visualState.cameraId,
        ).name,
    ),
    "shore",
  );
  await page.getByRole("button", { name: "Done ×", exact: true }).click();
  checks.push(
    "double-click dives without opening an editor; back restores all; search flies to the owner",
  );
  await page
    .getByRole("button", { name: "▤ Score sheet", exact: true })
    .click();
  await page.evaluate(() => window.editorStudy.setFixture("nested"));
  const id = await page.evaluate(
    () => window.editorStudy.targets.find((t) => t.setting?.name === "lpf").id,
  );
  await page.evaluate((id) => window.editorStudy.choose(id), id);
  await ready();
  assert.equal(await page.locator(".system-inset").count(), 1);
  const nested = await page.locator(".system-inset .nested-moon").count();
  assert(nested >= 2);
  const before = await page.locator("#breadcrumb").textContent();
  await page.locator(".system-inset .nested-moon").first().click();
  await ready();
  assert.equal(await page.locator(".editor").count(), 1);
  assert.notEqual(await page.locator("#breadcrumb").textContent(), before);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const [a, b] = await Promise.all([
      page.locator(".system-inset").boundingBox(),
      page.locator(".editor").boundingBox(),
    ]);
    assert(a && b);
    assert(
      width === 390 ? a.y + a.height <= b.y + 1 : a.x + a.width <= b.x + 1,
    );
  }
  await page.getByRole("button", { name: "Done ×", exact: true }).click();
  checks.push(
    "selected-only inset nests driver ownership, changes the single editor, and sits beside/above it",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.editorStudy.setFixture("three"));
  await page
    .getByRole("button", { name: "◎ Constellation", exact: true })
    .click();
  await page.getByRole("button", { name: "Middle", exact: true }).click();
  await page.locator("#play").click();
  const samples = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        let n = 0;
        const sample = () => {
          samples.push({
            phase: window.editorStudy.engine.phase(),
            pulse: [...document.querySelectorAll("[data-pulse]")].map((e) =>
              Number(e.getAttribute("r")),
            ),
            drivers: [...document.querySelectorAll("[data-driver-value]")].map(
              (e) => e.textContent,
            ),
          });
          if (++n === 25) resolve(samples);
          else setTimeout(sample, 70);
        };
        sample();
      }),
  );
  assert(samples.some((s) => s.pulse.some((r) => r > 31.1)));
  assert(
    new Set(
      samples
        .flatMap((s) => s.drivers)
        .filter((v) => v !== "∿" && v !== "BROKEN"),
    ).size > 1,
  );
  await page.getByRole("button", { name: "Mute lead", exact: true }).click();
  await ready();
  const muted = await page.evaluate(() => ({
    muted:
      document.querySelector("#universe [data-instrument][data-muted=true]") !==
      null,
    source: window.editorStudy.source,
  }));
  assert(muted.muted);
  await page.locator("#play").click();
  checks.push(
    "engine-clock pulses and real driver values move; typed mute is visible and consistent",
  );
  await page.evaluate(() => window.editorStudy.setCorpus("real-dnb-arranged"));
  await page.getByRole("button", { name: "Far", exact: true }).click();
  const beforeSection = await page.evaluate(
    () => window.editorStudy.visualState.systems,
  );
  await page.locator("[data-action=jump-section]").nth(2).click();
  await ready();
  const afterSection = await page.evaluate(
    () => window.editorStudy.visualState.systems,
  );
  assert.deepEqual(
    beforeSection.map((s) => s.id),
    afterSection.map((s) => s.id),
  );
  assert(
    afterSection.filter((s) => s.active).length >
      beforeSection.filter((s) => s.active).length,
  );
  assert((await page.locator("animateTransform").count()) > 0);
  checks.push(
    "section jump retains shared planet identities and animates active/peripheral changes",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("[data-action=jump-section]").first().click();
  await ready();
  assert.equal(await page.locator("animateTransform").count(), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  checks.push("reduced motion suppresses spatial transitions");
  const frames = [];
  if (process.env.CAPTURE_MOTION) {
    // Short real-clock frame sequence. No synthetic playback clock is injected.
    mkdirSync("shots/v3", { recursive: true });
    await page.setViewportSize({ width: 1000, height: 800 });
    const clip = await page.locator("#space").boundingBox();
    await page.locator("#play").click();
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(120);
      const phase = await page.evaluate(() =>
        window.editorStudy.engine.phase(),
      );
      const path = `shots/v3/motion-${String(i).padStart(2, "0")}.jpg`;
      await page.screenshot({ path, type: "jpeg", quality: 45, clip });
      frames.push({ path, phase });
      if (i === 3) {
        await page.locator("[data-action=jump-section]").nth(3).click();
        await ready();
      }
    }
    await page.locator("#play").click();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    "study-03-browser.json",
    JSON.stringify(
      {
        durationMs: performance.now() - start,
        checks,
        errors,
        samples,
        frames,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ durationMs: performance.now() - start, checks, errors }),
  );
} finally {
  await browser.close();
  await server.httpServer.close();
}
