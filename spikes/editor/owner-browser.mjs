import { chromium } from "@playwright/test";
import { preview } from "vite";
import { freePort } from "./serve.mjs";
import { existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import assert from "node:assert/strict";
const start = performance.now(),
  checks = [],
  errors = [],
  results = { checks, errors };
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
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(9000);
page.on("pageerror", (e) => errors.push(String(e)));
const timer = setTimeout(() => browser.close(), 85000);
const ready = () =>
  page.waitForFunction(() => window.editorStudy && !window.editorStudy.busy);
const click = async (selector) => {
  await page.locator(selector).click();
  await ready();
};
const load = async (id) => {
  await page.locator("#piece").selectOption(id);
  await page.waitForFunction(
    (id) =>
      !window.editorStudy.busy && document.querySelector("#piece").value === id,
    id,
  );
};
const row = (id) => `tbody tr[data-instrument="${id}"]`;
async function muted(expected) {
  assert.deepEqual(
    await page
      .locator("tbody tr.muted")
      .evaluateAll((rs) => rs.map((r) => r.dataset.instrument).sort()),
    [...expected].sort(),
  );
  if (!process.env.RED) {
    for (const id of await page
      .locator("tbody tr")
      .evaluateAll((rs) => rs.map((r) => r.dataset.instrument))) {
      const yes = expected.includes(id);
      assert.equal(
        await page
          .locator(`${row(id)} [data-action="mute"]`)
          .getAttribute("aria-pressed"),
        String(yes),
      );
      assert.equal(
        await page
          .locator(`.voice-nav[data-instrument="${id}"]`)
          .getAttribute("data-muted"),
        String(yes),
      );
    }
  }
}
async function dispatched(excluded, allowed, minimum = 1) {
  await page.waitForFunction(
    () =>
      window.editorStudy.engine.playing &&
      window.editorStudy.engine.repl?.state.started &&
      !window.editorStudy.engine.repl.state.pending,
  );
  const rev = await page.evaluate(() => window.editorStudy.engine.revision);
  await page.waitForFunction(
    ({ rev, allowed, minimum }) => {
      const ds = window.editorStudy.engine.dispatches.filter(
        (d) => d.revision === rev,
      );
      return allowed.every(
        (id) => ds.filter((d) => d.value.__planet === id).length >= minimum,
      );
    },
    { rev, allowed, minimum },
  );
  const ids = await page.evaluate(
    (rev) =>
      window.editorStudy.engine.dispatches
        .filter((d) => d.revision === rev)
        .map((d) => d.value.__planet),
    rev,
  );
  assert(ids.length > 0);
  assert(
    ids.every((id) => !excluded.includes(id)),
    JSON.stringify({ rev, ids, excluded }),
  );
  return { rev, ids: [...new Set(ids)] };
}
try {
  if (process.env.OFFLINE)
    await page.route("https://**/*", (route) =>
      route.abort("internetdisconnected"),
    );
  await page.goto(server.resolvedUrls.local[0]);
  await ready();
  if (process.env.RED) {
    await page.evaluate(() => window.editorStudy.engine.init());
    results.registry = await page.evaluate(() =>
      Object.fromEntries(
        ["bd", "hh", "cp", "sawtooth"].map((s) => [
          s,
          !!window.editorStudy.engine.web.getSound(s),
        ]),
      ),
    );
  }
  for (const piece of process.env.OFFLINE
    ? []
    : ["real-techno", "real-house-vocals"]) {
    await load(piece);
    if (piece === "real-house-vocals") await click('.sections [data-id="2"]');
    const rows = await page.locator("tbody tr").evaluateAll((rs) =>
      rs.map((r) => ({
        id: r.dataset.instrument,
        name: r.querySelector(".name").textContent,
      })),
    );
    const [a, b] = rows;
    if (!process.env.RED) {
      await page.evaluate(() =>
        window.editorStudy.engine.inspect(window.editorStudy.document),
      );
      await click('[data-action="play"]');
      checks.push({
        piece,
        initialDispatches: await dispatched(
          [],
          piece === "real-techno"
            ? rows.map((r) => r.id)
            : [
                a.id,
                rows.find((r) => r.name === "bass").id,
                rows.find((r) => r.name === "kick").id,
              ],
        ),
      });
    }
    await click(`${row(a.id)} [data-action="mute"]`);
    await muted([a.id]);
    if (!process.env.RED)
      await dispatched(
        [a.id],
        piece === "real-techno"
          ? rows.slice(1).map((r) => r.id)
          : [
              rows.find((r) => r.name === "bass").id,
              rows.find((r) => r.name === "kick").id,
            ],
      );
    await click(`${row(b.id)} [data-action="mute"]`);
    await muted([a.id, b.id]);
    if (!process.env.RED)
      await dispatched(
        [a.id, b.id],
        piece === "real-techno"
          ? rows.slice(2).map((r) => r.id)
          : [
              rows.find((r) => r.name === "bass").id,
              rows.find((r) => r.name === "kick").id,
            ],
      );
    await click(`${row(a.id)} [data-action="mute"]`);
    await muted([b.id]);
    if (!process.env.RED)
      await dispatched(
        [b.id],
        piece === "real-techno"
          ? rows.filter((r) => r.id !== b.id).map((r) => r.id)
          : [a.id, rows.find((r) => r.name === "bass").id],
      );
    if (piece === "real-house-vocals") await click('.sections [data-id="4"]');
    else await click('[data-action="cycle-next"]');
    await muted([b.id]);
    await click('[data-action="map-a"]');
    const planets = await page.locator(".planet").evaluateAll((ps) =>
      ps.map((p) => ({
        id: p.dataset.instrument,
        muted: p.dataset.muted,
        text: p.querySelector(".planet-state").textContent,
      })),
    );
    checks.push({ piece, planets });
    if (process.env.RED) {
      results.muteRegression = planets[1].text.includes("Muted")
        ? "passed"
        : "failed: muted row still claims Playing in Constellation";
      await click('[data-action="map-b"]');
    } else {
      assert.deepEqual(
        planets.filter((p) => p.muted === "true").map((p) => p.id),
        [b.id],
      );
      await page.screenshot({ path: `shots/owner-${piece}-constellation.png` });
      await click('[data-action="undo"]');
      await click('[data-action="map-b"]');
      await muted([a.id, b.id]);
      await click('[data-action="redo"]');
      await muted([b.id]);
      const source = await page.evaluate(() => window.editorStudy.source);
      await click(`${row(a.id)} [data-action="solo"]`);
      assert.equal(
        await page.evaluate(() => window.editorStudy.source),
        source,
      );
      await dispatched(
        rows.filter((r) => r.id !== a.id).map((r) => r.id),
        [a.id],
      );
      await click(`${row(a.id)} [data-action="solo"]`);
      await muted([b.id]);
      assert.equal(
        await page.evaluate(() => window.editorStudy.source),
        source,
      );
      const order = rows.map((r) => r.id);
      await click(`${row(a.id)} [data-action="row-down"]`);
      assert.deepEqual(
        await page
          .locator("tbody tr")
          .evaluateAll((rs) => rs.map((r) => r.dataset.instrument)),
        [b.id, a.id, ...order.slice(2)],
      );
      assert.equal(
        await page.evaluate(() => window.editorStudy.source),
        source,
      );
      await click(`${row(a.id)} [data-action="collapse"]`);
      assert.equal(await page.locator(row(a.id) + " .lane").count(), 0);
      assert.equal(
        await page.evaluate(() => window.editorStudy.source),
        source,
      );
      await click('[data-action="play"]');
      await page.screenshot({ path: `shots/owner-${piece}-sheet.png` });
      checks.push(
        `${piece}: mute two, unmute first, section/cycle, map, undo/redo, solo, reorder, collapse; real pointer clicks and scheduler tags`,
      );
    }
  }
  if (!process.env.RED) {
    await load("real-techno");
    const ids = await page
      .locator("tbody tr")
      .evaluateAll((rs) => rs.map((r) => r.dataset.instrument));
    await page.evaluate(() =>
      window.editorStudy.engine.inspect(window.editorStudy.document),
    );
    results.audio = await page.evaluate(async (ids) => {
      const e = window.editorStudy.engine,
        w = e.web;
      const readiness = await Promise.all(
        ["bd", "hh", "cp"].map((s) => e.sounds.check({ s })),
      );
      if (readiness.some((r) => r.state !== "ready")) {
        const online = await fetch(
          "https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json",
          { signal: AbortSignal.timeout(3000) },
        )
          .then((r) => r.ok)
          .catch(() => false);
        if (!online) return { status: "not checked: offline", readiness };
        throw Error(
          "Network available but default drums unavailable: " +
            JSON.stringify(readiness),
        );
      }
      const ac = w.getAudioContext();
      await ac.resume();
      await w.initAudio();
      const code = `class OwnerTap extends AudioWorkletProcessor{process(inputs){if(inputs[0]?.[0])this.port.postMessage({frame:currentFrame,channels:inputs[0].map(c=>c.slice())});return true;}}registerProcessor('owner-tap',OwnerTap)`;
      const url = URL.createObjectURL(
        new Blob([code], { type: "text/javascript" }),
      );
      await ac.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const tap = new AudioWorkletNode(ac, "owner-tap", { channelCount: 2 }),
        chunks = [];
      const output = w.getSuperdoughAudioController().output.destinationGain;
      output.connect(tap);
      const silent = ac.createGain();
      silent.gain.value = 0;
      tap.connect(silent).connect(ac.destination);
      tap.port.onmessage = ({ data }) => chunks.push(data);
      window.ownerTap = { chunks, rate: ac.sampleRate, tap, output };
      return { status: "tap installed", rate: ac.sampleRate, readiness };
    }, ids);
    if (results.audio.status !== "not checked: offline") {
      // Mute all but one actual techno row. Bass is always muted. No synthetic
      // test tones and no direct superdough calls can satisfy this measurement.
      const measured = [];
      for (let drum = 0; drum < 3; drum++) {
        for (let i = 0; i < ids.length; i++) {
          const isMuted =
            (await page.locator(row(ids[i])).getAttribute("data-muted")) ===
            "true";
          if (isMuted !== (i !== drum))
            await click(`${row(ids[i])} [data-action="mute"]`);
        }
        await page.evaluate(() => {
          window.editorStudy.engine.dispatches = [];
          window.ownerTap.chunks.length = 0;
        });
        await click('[data-action="play"]');
        await dispatched(
          ids.filter((_, i) => i !== drum),
          [ids[drum]],
          3,
        );
        await page.waitForTimeout(160);
        const measurement = await page.evaluate((id) => {
          const { chunks, rate } = window.ownerTap;
          const onsets = window.editorStudy.engine.dispatches
            .filter(
              (d) =>
                d.value.__planet === id &&
                d.target + 0.12 < window.editorStudy.engine.audioTime(),
            )
            .slice(0, 2);
          return onsets.map((d) => {
            let sum = 0,
              n = 0,
              peak = 0,
              beforeSum = 0,
              beforeN = 0;
            for (const c of chunks)
              for (const channel of c.channels)
                for (let j = 0; j < channel.length; j++) {
                  const time = (c.frame + j) / rate;
                  if (time >= d.target - 0.105 && time < d.target - 0.005) {
                    beforeSum += channel[j] ** 2;
                    beforeN++;
                  }
                  if (time >= d.target + 0.005 && time < d.target + 0.105) {
                    sum += channel[j] ** 2;
                    n++;
                    peak = Math.max(peak, Math.abs(channel[j]));
                  }
                }
            return {
              sound: d.value.s,
              begin: d.begin,
              target: d.target,
              rms: Math.sqrt(sum / (n || 1)),
              peak,
              samples: n,
              beforeRms: Math.sqrt(beforeSum / (beforeN || 1)),
              beforeSamples: beforeN,
            };
          });
        }, ids[drum]);
        assert.equal(measurement.length, 2);
        assert(
          measurement.every((x) => x.samples > 1000 && x.rms > 0.00001),
          JSON.stringify(measurement),
        );
        assert(
          measurement[0].beforeSamples > 1000 &&
            measurement[0].rms > measurement[0].beforeRms * 3,
          "drum onset must exceed pre-onset background: " +
            JSON.stringify(measurement),
        );
        measured.push(...measurement);
        await click('[data-action="play"]');
        await page.waitForTimeout(500); // allow previous voice's short tail to decay
      }
      results.audio = {
        ...results.audio,
        status: "non-silent drum onsets measured",
        measured,
        bassMuted: true,
      };
      await page.evaluate(() => {
        const t = window.ownerTap;
        t.output.disconnect(t.tap);
        t.tap.disconnect();
      });
    }
    if (process.env.OFFLINE) {
      assert.equal(results.audio.status, "not checked: offline");
      for (const name of ["bd", "hh", "cp"])
        assert(
          results.audio.readiness.some(
            (s) => s.name === name && s.state === "missing",
          ),
        );
      assert.equal(
        await page.locator('tbody [data-sound-state="missing"]').count(),
        3,
      );
    }
    checks.push(results.audio.status);
    if (!process.env.OFFLINE) {
      const auditInput = JSON.parse(
        readFileSync("sound-audit-input.json", "utf8"),
      );
      const audit = await page.evaluate(async (input) => {
        const library = window.editorStudy.engine.sounds;
        const cache = new Map();
        for (const row of input.rows)
          row.sounds = await Promise.all(
            row.uses.map(async (use) => {
              const key = JSON.stringify(use.value);
              if (!cache.has(key)) cache.set(key, library.check(use.value));
              return cache.get(key);
            }),
          );
        return input;
      }, auditInput);
      writeFileSync("sound-audit.json", JSON.stringify(audit, null, 2) + "\n");
      const lines = [
        "# Corpus sound audit",
        "",
        "Default registry: piano, drum machines, EmuSP12, VCSL, mridangam and the complete Dirt sample set. Names below come from real Strudel event queries, with authored muted voices enabled, across at least 16 cycles or the declared full piece length (maximum 512). Broken queries are explicitly marked; cycle zero is attempted separately. Sample readiness means downloaded and decoded, not heard.",
        "",
        "| Program | Sounds | Missing / unchecked |",
        "| --- | --- | --- |",
      ];
      for (const r of audit.rows) {
        const names = [...new Set(r.sounds.map((s) => s.name))].sort();
        const bad = [
          ...new Set(
            r.sounds.filter((s) => s.state !== "ready").map((s) => s.name),
          ),
        ];
        lines.push(
          `| ${r.id} | ${names.join(", ") || "none queried"} | ${[...bad, ...(r.error ? ["query error: " + r.error.replaceAll("|", "/")] : [])].join("; ") || "—"} |`,
        );
      }
      writeFileSync("SOUND-AUDIT.md", lines.join("\n") + "\n");
      results.audit = {
        pieces: audit.rows.length,
        missing: audit.rows
          .filter((r) => r.sounds.some((s) => s.state !== "ready"))
          .map((r) => ({
            id: r.id,
            sounds: [
              ...new Set(
                r.sounds.filter((s) => s.state !== "ready").map((s) => s.name),
              ),
            ],
          })),
        queryErrors: audit.rows
          .filter((r) => r.error)
          .map((r) => ({ id: r.id, error: r.error })),
      };
      // A program's setup is executed by the real browser/transpiler, including
      // samples(...) without await. The WAV is an actual decodable fixture.
      const wav = Buffer.alloc(44 + 9600);
      wav.write("RIFF");
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(24000, 24);
      wav.writeUInt32LE(48000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(9600, 40);
      for (let i = 0; i < 4800; i++)
        wav.writeInt16LE(
          Math.round(Math.sin((i * 2 * Math.PI * 440) / 24000) * 6000),
          44 + i * 2,
        );
      const custom = `samples({owner_bell: 'data:audio/wav;base64,${wav.toString("base64")}'}); stack(s("owner_bell"), s("owner_missing_voice"))`;
      await click('[data-action="paste"]');
      await page.locator("#paste-source").fill(custom);
      await click('[data-action="import"]');
      await click('[data-action="done"]');
      await page.evaluate(() =>
        window.editorStudy.engine.inspect(window.editorStudy.document),
      );
      assert(
        (await page.locator("tbody tr").first().textContent()).includes(
          "Ready · owner_bell",
        ),
      );
      assert(
        (await page.locator("tbody tr").nth(1).textContent()).includes(
          "Missing sound · owner_missing_voice",
        ),
      );
      await click('[data-action="map-a"]');
      assert(
        (await page.locator(".planet").nth(1).textContent()).includes(
          "Missing sound · owner_missing_voice",
        ),
      );
      await page
        .locator(".planet")
        .nth(1)
        .locator("[data-select]")
        .first()
        .click();
      await ready();
      assert(
        (await page.locator(".instrument-status").textContent()).includes(
          "Missing sound · owner_missing_voice",
        ),
      );
      await page.screenshot({ path: "shots/owner-missing-editor.png" });
      checks.push(
        "program-level unawaited samples setup downloads and decodes a WAV; a separate missing name is visible in both maps and editor",
      );
      await click('[data-action="done"]');
      for (const piece of ["real-techno", "real-house-vocals"]) {
        await click('[data-action="map-b"]');
        await load(piece);
        if (piece === "real-house-vocals")
          await click('.sections [data-id="2"]');
        await page.evaluate(() =>
          window.editorStudy.engine.inspect(window.editorStudy.document),
        );
        const rows = await page.locator("tbody tr").evaluateAll((rs) =>
          rs.map((r) => ({
            id: r.dataset.instrument,
            name: r.querySelector(".name").textContent,
          })),
        );
        const first = rows[0];
        await click(`${row(first.id)} .name`);
        await page.locator("#apply-mode").selectOption("next");
        await click('[data-action="done"]');
        await click('[data-action="play"]');
        await dispatched([], [first.id]);
        await click(`${row(first.id)} [data-action="mute"]`);
        const boundary = await page.evaluate(
          () => window.editorStudy.pending?.first,
        );
        assert(Number.isInteger(boundary));
        await page.waitForFunction(
          () => window.editorStudy.pending === undefined,
        );
        const rev = await page.evaluate(
          () => window.editorStudy.engine.revision,
        );
        const observed = await page.evaluate(
          ({ rev, boundary, id }) =>
            window.editorStudy.engine.dispatches.filter(
              (d) =>
                d.revision === rev &&
                d.begin >= boundary &&
                d.value.__planet === id,
            ),
          { rev, boundary, id: first.id },
        );
        assert.deepEqual(observed, []);
        assert(
          await page.evaluate(
            ({ rev, boundary, id }) =>
              window.editorStudy.engine.dispatches.some(
                (d) =>
                  d.revision === rev &&
                  d.begin < boundary &&
                  d.value.__planet === id,
              ),
            { rev, boundary, id: first.id },
          ),
          "old instrument must still dispatch before aligned boundary",
        );
        await click(`${row(first.id)} .name`);
        await page.locator("#apply-mode").selectOption("now");
        await click('[data-action="done"]');
        await click(`${row(first.id)} [data-action="mute"]`);
        await dispatched([], [first.id]);
        await click('[data-action="play"]');
        checks.push(
          `${piece}: next-cycle mute retains old events before boundary, removes instrument after boundary, clears pending without requiring a nonexistent onset; Apply now restores its dispatches`,
        );
      }
    }
    assert.deepEqual(errors, []);
  }
} catch (error) {
  results.failure = String(error);
  results.debug = await page
    .evaluate(() => ({
      playing: window.editorStudy.engine.playing,
      revision: window.editorStudy.engine.revision,
      dispatches: window.editorStudy.engine.dispatches.slice(-8),
      pending: window.editorStudy.pending,
      status: document.querySelector("#status").textContent,
    }))
    .catch(() => null);
  await page.screenshot({ path: "shots/owner-failure.png" }).catch(() => {});
  if (!process.env.RED) throw error;
} finally {
  results.durationMs = performance.now() - start;
  writeFileSync(
    process.env.RED
      ? "owner-browser-red.json"
      : process.env.OFFLINE
        ? "owner-browser-offline.json"
        : "owner-browser-results.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results));
  clearTimeout(timer);
  await browser.close();
  await server.httpServer.close();
}
