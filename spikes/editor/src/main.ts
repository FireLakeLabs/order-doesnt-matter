import "./style.css";
import * as core from "@strudel/core";
import { fixtures, shell } from "./fixtures";
import {
  History,
  targets,
  update,
  addVoice,
  addSetting,
  addShell,
  changeStep,
  moveShell,
  makeDriver,
  toggleMute,
  ownerId,
  paintSequence,
  type Doc,
  type Pattern,
  type Step,
  type Target,
} from "./document";
import {
  generate,
  queryEvents,
  importStrudel,
  type PlainEvent,
} from "./adapter";
import { patternSource, sourceUntil } from "./fallback";
import {
  constellation,
  sheet,
  rooms,
  settings,
  searchTargets,
  colors,
  span,
  valueAt,
  type EventMap,
} from "./scene";
import { Engine } from "./engine";
import { tagVoices, atBoundary } from "./query-document";
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw Error("No app root");
const corpusSources = import.meta.glob("../../../corpus/programs/*.strudel", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const corpusDocs = Object.entries(corpusSources).map(([file, source]) => ({
  id: file.split("/").at(-1)!.replace(".strudel", ""),
  source,
  ...importStrudel(source),
}));
const history = new History(structuredClone(fixtures[0]!.doc));
const engine = new Engine();
let map: "constellation" | "sheet" = "constellation",
  selected = "",
  open = false,
  events: EventMap = {},
  errors: Record<string, string> = {},
  cycle = 0,
  phase = 0,
  piece = "three",
  query = "",
  collapsed = new Set<string>(),
  solo = "",
  zoom = Math.min(
    1,
    (window.innerWidth - (window.innerWidth > 650 ? 240 : 0)) /
      (window.innerWidth <= 650 ? 400 : 1200),
  ),
  pan = { x: 0, y: 0 },
  editPath: number[] = [0],
  before: PlainEvent[] = [],
  after: PlainEvent[] = [],
  previewEvents: PlainEvent[] = [],
  busy = false,
  serial = 0,
  mode = "now",
  warning = "",
  paste = false,
  adding: "" | "setting" | "shell" = "",
  addQuery = "",
  revision = 0,
  queued: Doc | undefined;
let rowOrder: string[] = [];
let gestureActive = false;
let pending:
  | { id: string; revision: number; first: number; queued: boolean }
  | undefined;
const changeLog: { revision: number; state: string; cycle: number }[] = [];
const esc = (x: unknown) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
const doc = () => history.doc;
const selectedTarget = () => targets(doc()).find((t) => t.id === selected);
const target = (id: string) => targets(doc()).find((t) => t.id === id);
const button = (text: string, action: string, extra = "") =>
  `<button data-action="${action}" ${extra}>${text}</button>`;
function lane(es: PlainEvent[], name = "", height = 32) {
  const vals = es
      .map((e) => Number(name ? valueAt(e, name) : e.value))
      .filter(Number.isFinite),
    lo = Math.min(0, ...vals),
    hi = Math.max(1, ...vals);
  return `<svg class="lane" style="height:${height}px" viewBox="0 0 300 ${height}" preserveAspectRatio="none" role="img" aria-label="Real queried ${esc(name || "event")} spans, cycle ${cycle}"><path d="M0 ${height - 2}H300" class="axis"/>${[0, 0.25, 0.5, 0.75, 1].map((x) => `<path d="M${x * 300} 0V${height}" class="tick"/>`).join("")}${es
    .slice(0, 400)
    .map((e, i) => {
      const [a, b] = span(e, cycle),
        v = name ? valueAt(e, name) : e.value,
        n = Number(v),
        h = Number.isFinite(n)
          ? 7 + ((n - lo) / (hi - lo)) * (height - 12)
          : height - 10;
      return `<rect x="${a * 300}" y="${height - h - 2}" width="${Math.max(0.7, (b - a) * 300 - 1)}" height="${Math.max(2, h)}" rx="2" fill="${name ? "#c3b0f1" : colors[i % 4]}" opacity=".8"><title>${esc(v)} · ${a.toFixed(4)}–${b.toFixed(4)}</title></rect>`;
    })
    .join(
      "",
    )}<path class="playline" d="M${(phase % 1) * 300} 0V${height}"/></svg>`;
}
function ring(es: PlainEvent[], size = 92) {
  const p = (a: number, r: number) =>
    `${(50 + Math.cos(a * Math.PI * 2 - Math.PI / 2) * r).toFixed(3)} ${(50 + Math.sin(a * Math.PI * 2 - Math.PI / 2) * r).toFixed(3)}`;
  return `<svg class="ring" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Read-only voice cycle"><circle cx="50" cy="50" r="39" fill="none" stroke="#304450"/>${es
    .slice(0, 300)
    .map((e, i) => {
      let [a, b] = span(e, cycle);
      b = Math.min(b, a + 0.9999);
      return `<path d="M${p(a, 34 - (i % 3) * 4)} A${34 - (i % 3) * 4} ${34 - (i % 3) * 4} 0 ${b - a > 0.5 ? 1 : 0} 1 ${p(b, 34 - (i % 3) * 4)}" fill="none" stroke="${colors[i % 4]}" stroke-width="3"/>`;
    })
    .join(
      "",
    )}<path class="ringhead" d="M50 50L${p(phase % 1, 41)}" stroke="#e7fff5" stroke-width="1"/><text x="50" y="51" text-anchor="middle" fill="#94abae" font-size="10">${cycle}</text></svg>`;
}
function chosen(id: string) {
  const t = selectedTarget();
  return selected === id ||
    (t &&
      !t.setting &&
      (id === t.voice.id || id === t.voice.pattern.id || id === t.parent?.id))
    ? " selected"
    : "";
}
function sourceNodes() {
  return `<div class="source-nodes">${doc()
    .setup.map((x, i) =>
      button(`◇ Setup ${i + 1} · source`, "select", `data-id="${x.id}"`),
    )
    .join("")}${Object.entries(doc().shared)
    .map(([name, p]) =>
      button(`↳ Shared: ${esc(name)}`, "select", `data-id="${p.id}"`),
    )
    .join("")}${
    doc()
      .transforms?.map((x) =>
        button(`all · global rewrite`, "select", `data-id="${x.id}"`),
      )
      .join("") ?? ""
  }</div>`;
}
function mapHtml() {
  if (map === "sheet") return sourceNodes() + sheetHtml();
  const scene = constellation(
    doc(),
    events,
    collapsed,
    window.innerWidth <= 650 ? 1 : 3,
  );
  return (
    sourceNodes() +
    `<div class="space" id="space"><svg id="universe" viewBox="0 0 ${scene.width} ${scene.height}" style="width:${scene.width * zoom}px;height:${scene.height * zoom}px;transform:translate(${pan.x}px,${pan.y}px)" aria-label="Constellation map. Orbits mean belongs to, never sound flow.">
${scene.rooms
  .map((r) => {
    const ps = scene.planets.filter(
      (p) =>
        r.voices.includes(p.voice) &&
        p.events.some(
          (e) =>
            String(valueAt(e, "orbit") ?? 1) === r.id &&
            (Number(valueAt(e, "room")) > 0 || Number(valueAt(e, "delay")) > 0),
        ),
    );
    if (!ps.length) return "";
    const minx = Math.min(...ps.map((p) => p.x)) - 190,
      miny = Math.min(...ps.map((p) => p.y)) - 195,
      maxx = Math.max(...ps.map((p) => p.x)) + 190,
      maxy = Math.max(...ps.map((p) => p.y)) + 200;
    return `<rect class="room-region" x="${minx}" y="${miny}" width="${maxx - minx}" height="${maxy - miny}" rx="30"/><text x="${minx + 15}" y="${miny + 23}" class="room-label">ROOM ${esc(r.id)} · ${r.voices.length} voices ${r.conflict ? "· ⚠ CONFLICT" : ""}</text>`;
  })
  .join("")}
${scene.planets
  .map(
    (
      p,
    ) => `<g class="planet ${pending && target(pending.id)?.voice.id === p.voice ? "pending" : ""}">${p.group ? `<rect x="${p.x - 185}" y="${p.y - 180}" width="370" height="370" rx="24" class="group-box"/><text x="${p.x - 170}" y="${p.y - 153}" class="room-label">${esc(p.group)} contains</text>` : ""}${p.shells.map((s) => `<g data-select="${s.id}" tabindex="0" role="button" aria-label="${esc(p.name)} rewrite ${esc(s.name)}"><circle cx="${p.x}" cy="${p.y}" r="${s.r}" class="shell${chosen(s.id)}"/><rect x="${p.x - 37}" y="${p.y + s.r - 9}" width="75" height="19" rx="7" class="shell-label-bg"/><text x="${p.x}" y="${p.y + s.r + 4}" text-anchor="middle" class="shell-label">${esc(s.name)}</text></g>`).join("")}${p.nodes
      .filter((n) => n.kind === "setting")
      .map(
        (n) =>
          `<circle cx="${p.x}" cy="${p.y}" r="${Math.hypot(n.x - p.x, n.y - p.y)}" class="orbit"/>`,
      )
      .join("")}
<g data-select="${p.id}" tabindex="0" role="button" aria-label="${esc(p.name)} rhythm" class="planet-face${chosen(p.id)} ${p.tier === 3 ? "opaque" : ""}"><circle cx="${p.x}" cy="${p.y}" r="${p.radius}"/> <svg x="${p.x - 41}" y="${p.y - 39}" width="82" height="82" viewBox="0 0 100 100">${ring(
      p.events,
    )
      .replace(/^.*?<svg[^>]*>/, "")
      .replace(
        /<\/svg>$/,
        "",
      )}</svg><text x="${p.x}" y="${p.y - 7}" text-anchor="middle">${esc(p.name)}</text><text x="${p.x}" y="${p.y + 11}" text-anchor="middle" class="small">${p.tier === 3 ? "◇ SOURCE" : "rhythm"}</text></g>
${p.nodes.map((n) => `<g data-select="${n.id}" tabindex="0" role="button" aria-label="${esc(p.name)} ${esc(target(n.id)?.path.slice(1).join(" › ") ?? n.label)}" class="moon ${n.kind} ${n.tier === 3 ? "opaque" : ""}${chosen(n.id)}">${n.kind === "driver" ? `<circle cx="${p.nodes.find((q) => q.id === n.owner)?.x ?? p.x}" cy="${p.nodes.find((q) => q.id === n.owner)?.y ?? p.y}" r="55" class="driver-orbit"/>` : ""}<circle cx="${n.x}" cy="${n.y}" r="${n.r}"/><text x="${n.x}" y="${n.y + 4}" text-anchor="middle">${esc(n.label)}</text>${n.kind === "setting" ? `<text class="level" x="${n.x}" y="${n.y + 33}" text-anchor="middle">level ${n.level + 1}</text>` : ""}</g>`).join("")}
<g role="button" tabindex="0" data-collapse="${p.id}" aria-label="${p.collapsed ? "Expand" : "Collapse"} ${esc(p.name)}"><rect x="${p.x - 42}" y="${p.y + 160}" width="84" height="25" rx="10" class="collapse-bg"/><text class="small" x="${p.x}" y="${p.y + 177}" text-anchor="middle">${p.collapsed ? "+ expand" : "− collapse"}</text></g></g>`,
  )
  .join("")}</svg></div>`
  );
}
function sheetHtml() {
  const data = sheet(doc(), events);
  if (rowOrder.length)
    data.rows.sort(
      (a, b) => rowOrder.indexOf(a.voice.id) - rowOrder.indexOf(b.voice.id),
    );
  return `<div class="sheet-scroll"><table><thead><tr><th class="voice-col">VOICE / RHYTHM</th><th>REAL EVENTS · ONE CYCLE</th>${data.columns.map((c) => `<th>${esc(c)}</th>`).join("")}<th>REWRITES · INNER → OUTER</th><th>ROOM</th></tr></thead><tbody>${data.rows
    .map(
      ({ voice: v, events: es, settings: ss }, i) =>
        `<tr class="${v.muted ? "muted" : ""} ${pending && target(pending.id)?.voice.id === v.id ? "pending" : ""}"><th class="voice-col"><div class="voice-name">${button(esc(v.name), "select", `data-id="${v.id}" class="name${chosen(v.id)}"`)} <span class="index">${String(i + 1).padStart(2, "0")}</span></div><div class="row-actions">${button(v.muted ? "Unmute" : "M", "mute", `data-id="${v.id}" title="Mute ${esc(v.name)}"`)}${button(solo === v.id ? "Unsolo" : "S", "solo", `data-id="${v.id}" title="Solo ${esc(v.name)}"`)}${button("↑", "row-up", `data-id="${v.id}" aria-label="Move ${esc(v.name)} up"`)}${button("↓", "row-down", `data-id="${v.id}" aria-label="Move ${esc(v.name)} down"`)}${button(collapsed.has(v.id) ? "+" : "−", "collapse", `data-id="${v.id}" aria-label="Collapse ${esc(v.name)}"`)}</div></th><td>${button(v.pattern.tier === 3 ? "◇ not modelled" : (v.pattern.core.kind === "generator" && !(["note", "s", "n"].includes(v.pattern.core.name) && v.pattern.core.args[0]?.kind === "pattern" && v.pattern.core.args[0].pattern.core.kind === "sequence")) || v.pattern.layers.some((l) => l.kind === "rewrite" && ["euclid", "degradeBy", "sometimes"].includes(l.name)) ? "◉ rule-made" : "▤ typed", "select", `data-id="${v.pattern.id}" class="cell${chosen(v.pattern.id)}"`)}${collapsed.has(v.id) ? "" : lane(es)}</td>${data.columns
          .map((c) => {
            const matches = targets({ ...doc(), voices: [v] }).filter(
              (t) => "value" in t.node && "name" in t.node && t.label === c,
            );
            return `<td>${
              matches
                .map((t) => {
                  const s = t.setting;
                  return s
                    ? button(
                        `${s.value.core.kind === "constant" ? esc(typeof s.value.core.value === "number" ? Number(s.value.core.value.toPrecision(5)) : s.value.core.value) : `${s.value.core.kind === "signal" ? "∿" : "▤"} ${esc(s.value.core.kind === "signal" ? s.value.core.shape : "pattern")} <span class="nested">↳ inspect driver</span>`}${!collapsed.has(v.id) && s.value.core.kind !== "constant" ? lane(es, c) : ""}`,
                        "select",
                        `data-id="${s.id}" class="cell${chosen(s.id)}" title="${esc(t.path.join(" › "))}"`,
                      )
                    : "";
                })
                .join("") || '<span class="empty">—</span>'
            }</td>`;
          })
          .join(
            "",
          )}<td><div class="chips">${v.pattern.layers.flatMap((l, k) => (l.kind === "settings" ? [] : [button(`${k + 1} ${esc(l.kind === "rewrite" ? l.name : "◇ source")}`, "select", `data-id="${l.id}" class="chip"`)])).join("")}</div></td><td>${
          rooms(doc(), events)
            .filter((r) => r.voices.includes(v.id))
            .map(
              (r) =>
                `<span class="room-pill">${r.id}${r.conflict ? " ⚠ conflict" : ""}</span>`,
            )
            .join("") || "—"
        }</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}
function render() {
  // A cycle/query refresh must not replace a captured drag target.
  if (gestureActive) return;
  const t = selectedTarget();
  app!.innerHTML = `<header><a class="brand" href="#">◎ <span>Order Doesn’t Matter</span></a><span class="study">TWO MAPS / ONE SCORE</span><div class="transport">${button(engine.playing ? "■ Stop" : "▶ Play", "play", 'id="play" class="primary"')}<span id="clock">${String(cycle).padStart(2, "0")} / ${(phase % 1).toFixed(2)}</span>${button("Undo", "undo", history.past.length ? "" : "disabled")}${button("Redo", "redo", history.future.length ? "" : "disabled")}</div></header><div class="workspace"><aside class="navigator" ${open ? "inert" : ""}><p class="eyebrow">AN INSTRUMENT FOR FINDING</p><h1>The score,<br>at a glance.</h1><label class="label" for="piece">PIECE</label><select id="piece"><optgroup label="Six design fixtures">${fixtures.map((f) => `<option value="${f.id}" ${f.id === piece ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</optgroup><optgroup label="72 corpus programs">${corpusDocs.map((f) => `<option value="${f.id}" ${f.id === piece ? "selected" : ""}>${esc(f.id)}</option>`).join("")}</optgroup></select>${button("Paste Strudel…", "paste", 'class="text-button"')}<div class="nav-divider"></div><label class="label" for="find">FIND A VOICE OR SETTING</label><input id="find" type="search" placeholder="Try “shore lpf”" value="${esc(query)}" autocomplete="off"><div class="results">${
    query
      ? searchTargets(doc(), query)
          .slice(0, 50)
          .map((x) =>
            button(
              esc(x.path.join(" › ")),
              "select",
              `data-id="${x.id}" class="result"`,
            ),
          )
          .join("") || "<p>No matches</p>"
      : doc()
          .voices.map(
            (v, i) =>
              `<div class="voice-nav"><button data-action="select" data-id="${v.id}"><i style="background:${colors[i % 4]}"></i>${esc(v.name)}${v.pattern.tier === 3 ? " ◇" : ""}</button><button data-action="focus" data-id="${v.id}" aria-label="Find ${esc(v.name)} in map">⌖</button></div>`,
          )
          .join("")
  }</div>${button("+ Add voice", "add-voice", 'class="add-voice"')}<div class="legend"><p><i class="mint"></i> Planet = rhythm / real events</p><p><i class="violet"></i> Moon = setting; satellite = driver</p><p><i class="amber"></i> Shell = ordered rewrite</p><p>Orbits mean “belongs to”.<br>There is no sound-flow path.</p><p>◇ Dashed = not modelled</p><small>Corpus importer · real Strudel queries</small></div></aside><main><div class="toolbar"><div class="tabs">${button("◎ Constellation", "map-a", `aria-pressed="${map === "constellation"}"`)}${button("▤ Score sheet", "map-b", `aria-pressed="${map === "sheet"}"`)}</div><div class="map-tools" ${open ? "inert" : ""}>${map === "constellation" ? `${button("−", "zoom-out", 'aria-label="Zoom out"')}${button("Fit", "fit")}${button("+", "zoom-in", 'aria-label="Zoom in"')}` : ""}<span>${doc().voices.length} voices · cycle ${cycle}</span></div></div><div class="map-intro"><div><p class="eyebrow">${map === "constellation" ? "BELONGING, WITHOUT WIRES" : "COMPARE ACROSS VOICES"}</p><h2>${map === "constellation" ? "A small universe of settings." : "One piece. All its settings."}</h2><p>${map === "constellation" ? "Click a planet, moon or labelled shell to edit. Drag empty space to pan. Scroll to explore; + / − to zoom." : "Click a cell to edit. ↳ opens nested drivers. Horizontal scroll reveals every setting; names stay pinned."}</p></div><div class="map-key">${map === "constellation" ? "Inner → outer: rewrite order<br>level N: settings at that shell" : "Bars are actual event spans<br>No equal-step grid is assumed"}</div></div><div class="map-container" ${open ? "inert" : ""}>${mapHtml()}</div><footer><span id="status" class="${Object.keys(errors).length ? "error" : ""}">${warning ? esc(warning) : Object.keys(errors).length ? `⚠ BROKEN · ${esc(Object.values(errors).join(" · "))}` : busy ? "Querying real events…" : `${Object.values(events).flat().length} queried event parts · scored length, not audible tails`}</span><span id="pending">${pending ? "◌ PENDING · waiting for first changed onset" : "● document and preview agree"}</span></footer></main></div>${open && t ? `<div class="scrim"></div>${editorHtml(t)}` : ""}${paste ? `<div class="modal-scrim"><section class="paste-panel"><h2>Bring in a score</h2><p>Executable Strudel, for this local study. Structured import; unsupported source stays selectable.</p><textarea id="paste-source" aria-label="Strudel to import">note("60 [64 67] 72").s("triangle")</textarea>${button("Import expression", "import", 'class="primary"')}${button("Cancel", "cancel-paste")}</section></div>` : ""}`;
  bind();
}
function argLabels(name: string) {
  return (
    (
      {
        euclid: ["Pulses", "Steps", "Rotation"],
        degradeBy: ["Drop probability"],
        fast: ["Speed ×"],
        slow: ["Cycles per turn"],
        late: ["Shift · cycles"],
        range: ["Lowest", "Highest"],
        off: ["Offset · cycles", "Rewrite callback"],
        every: ["Every N cycles", "Rewrite callback"],
        sometimes: ["Rewrite callback"],
      } as Record<string, string[]>
    )[name] ?? []
  );
}
function argForm(
  name: string,
  args: import("../../import/src/document").Arg[],
  prefix: string,
) {
  return `<div class="fields">${args.map((a, i) => `<label>${esc(argLabels(name)[i] ?? `Argument ${i + 1}`)}${a.kind === "literal" ? `<input data-arg="${i}" data-prefix="${prefix}" value="${esc(a.value)}" type="${typeof a.value === "number" ? "number" : "text"}" step="any">` : a.kind === "pattern" ? button(`↳ ${esc(a.pattern.core.kind)} · inspect`, "select", `data-id="${a.pattern.id}"`) : a.kind === "callback" ? button("↳ callback pattern · inspect", "select", `data-id="${a.body.id}"`) : `<textarea data-arg-source="${i}" data-prefix="${prefix}" aria-label="Argument ${i + 1} source">${esc(a.code)}</textarea>`}</label>`).join("")}</div>`;
}
function strip(steps: Step[], path: number[] = []): string {
  const total = steps.reduce(
    (n, s) => n + ("weight" in s ? (s.weight ?? 1) : 1),
    0,
  );
  return `<div class="step-group">${steps
    .map((s, i) => {
      const p = [...path, i],
        active = p.join(".") === editPath.join(".");
      return `<div class="step ${s.kind} ${active ? "active" : ""}" style="flex:${"weight" in s ? (s.weight ?? 1) : 1}">${"steps" in s ? `<button data-step="${p.join(".")}" class="group-caption">${s.kind === "alternate" ? "successive cycles ↓" : s.kind === "together" ? "together" : "sub-group"} · ${(("weight" in s ? (s.weight ?? 1) : 1) / total).toFixed(2)}</button>${strip(s.steps, p)}` : `<button data-step="${p.join(".")}" title="Select step ${p.join(".")}">${esc(s.kind === "value" ? s.value : s.kind === "rest" ? "rest" : s.notation)}</button>`}</div>`;
    })
    .join("")}</div>`;
}
function controlInfo(name: string) {
  return (
    (
      {
        lpf: {
          name: "Low-pass cutoff",
          unit: "Hz",
          min: 20,
          max: 16000,
          step: 10,
        },
        hpf: {
          name: "High-pass cutoff",
          unit: "Hz",
          min: 20,
          max: 16000,
          step: 10,
        },
        delaytime: {
          name: "Delay time",
          unit: "seconds",
          min: 0,
          max: 2,
          step: 0.01,
        },
        delayfeedback: {
          name: "Delay feedback",
          unit: "×",
          min: 0,
          max: 0.95,
          step: 0.01,
        },
        delay: { name: "Delay send", unit: "×", min: 0, max: 1, step: 0.01 },
        release: {
          name: "Release",
          unit: "seconds",
          min: 0,
          max: 4,
          step: 0.01,
        },
        crush: { name: "Bit depth", unit: "bits", min: 1, max: 16, step: 1 },
        distort: { name: "Distortion", unit: "×", min: 0, max: 10, step: 0.1 },
        note: { name: "Pitch", unit: "MIDI", min: 0, max: 127, step: 1 },
        gain: { name: "Gain", unit: "×", min: 0, max: 2, step: 0.01 },
        pan: {
          name: "Pan · left → right",
          unit: "",
          min: 0,
          max: 1,
          step: 0.01,
        },
        room: { name: "Reverb send", unit: "×", min: 0, max: 1, step: 0.01 },
        roomsize: {
          name: "Room size",
          unit: "seconds",
          min: 0.1,
          max: 4,
          step: 0.1,
        },
        orbit: {
          name: "Shared room number",
          unit: "room",
          min: 1,
          max: 16,
          step: 1,
        },
      } as Record<
        string,
        { name: string; unit: string; min: number; max: number; step: number }
      >
    )[name] ?? { name, unit: "value", min: 0, max: 10, step: 0.01 }
  );
}
function editorHtml(t: Target) {
  const node = t.node;
  const p = "pattern" in node ? node.pattern : t.pattern;
  const layer = "kind" in node && node.kind === "rewrite" ? node : undefined;
  const opaque =
    "code" in node
      ? node
      : "core" in node && node.core.kind === "opaque"
        ? node.core
        : p.core.kind === "opaque"
          ? p.core
          : undefined;
  const rootSelected =
    "pattern" in node || ("core" in node && node.id === t.voice.pattern.id);
  const rule = rootSelected
    ? p.layers.find(
        (l) =>
          l.kind === "rewrite" &&
          ["euclid", "degradeBy", "sometimes", "every"].includes(l.name),
      )
    : undefined;
  const kind = opaque
    ? "Source · not modelled"
    : layer
      ? layer.tier === 2
        ? "Named arguments · tier 2"
        : "Rewrite shell"
      : rule || p.core.kind === "generator"
        ? "Rule-made rhythm"
        : p.core.kind === "sequence"
          ? "Typed sequence"
          : p.core.kind === "signal"
            ? "Signal driver"
            : p.core.kind === "constant"
              ? "Constant setting"
              : p.core.kind === "group"
                ? "Group"
                : "Named arguments · tier 2";
  let body = "";
  if (opaque) {
    body = `<div class="notice source-notice">◇ NOT MODELLED · source stays visible and playable.</div><label class="label">SOURCE TEXT · edits evaluate automatically<textarea id="opaque-code" spellcheck="false">${esc(opaque.code)}</textarea></label><p class="help">Broken source shows an error, never a silent-looking empty lane.</p>`;
  } else if (layer) {
    body = `<div class="notice amber-text">Order matters here. Shells apply from inside to outside; moving past a settings bag also changes its level.</div><div class="comparison"><div><span class="label">ENTERING THIS SHELL</span>${lane(before)}</div><div><span class="label">LEAVING THIS SHELL</span>${lane(after)}</div></div><h3>${esc(layer.name)} arguments</h3>${argForm(layer.name, layer.args, "layer")}<div class="actions" ${t.layerIndex === undefined ? "hidden" : ""}>${button("← Move inward", "shell-in")}${button("Move outward →", "shell-out")}${button("Remove shell", "shell-remove", 'class="danger"')}</div><div class="order-list">${p.layers.map((l, i) => button(`${i + 1} · ${esc(l.kind === "rewrite" ? l.name : l.kind === "settings" ? "settings bag" : "source")}`, "select", `data-id="${l.id}" class="${l.id === layer.id ? "current" : ""}"`)).join("")}</div>`;
  } else if ("kind" in node && node.kind === "settings") {
    body = `<h3>Unordered settings · level ${(t.layerIndex ?? 0) + 1}</h3><div class="driver-tree">${node.settings.map((s) => button(esc(s.name), "select", `data-id="${s.id}"`)).join("")}</div>`;
  } else if (rule && rule.kind === "rewrite") {
    body = `<div class="notice">◉ Events come from <b>${esc(rule.name)}</b>. Individual notes cannot be moved: change the rule to change the rhythm.</div><h3>${esc(rule.name)}</h3>${argForm(rule.name, rule.args, "rule")}`;
    if (p.core.kind === "generator")
      body += `<h3>Source · ${esc(p.core.name)}</h3>${argForm(p.core.name, p.core.args, "generator")}`;
  } else if (p.core.kind === "generator") {
    body = `<div class="notice">Events are made by ${esc(p.core.name)}. Notes are read-only; edit named arguments.</div>${argForm(p.core.name, p.core.args, "generator")}`;
  } else if (p.core.kind === "sequence") {
    const s = stepValue(p.core.steps, editPath);
    body = `<div class="axis-labels"><span>${cycle} / start</span><span>¼</span><span>½</span><span>¾</span><span>${cycle + 1}</span></div><div class="strip ${pending ? "pending" : ""}">${strip(p.core.steps)}</div><p class="help">Input timeline, before voice shells. Width = weight. Sub-groups keep their nesting; stacked alternatives play on successive cycles.</p><h3>Step ${editPath.map((x) => x + 1).join(" › ")}</h3><div class="fields"><label>Value<input id="step-value" value="${esc(s?.kind === "value" ? s.value : "60")}"></label><label>Weight · relative duration<input id="step-weight" type="number" min="0.125" max="8" step="0.125" value="${s && "weight" in s ? (s.weight ?? 1) : 1}"></label></div><div class="actions">${button("Split into sub-group", "step-split")}${button("Merge sub-group", "step-merge")}${button("Rest / restore", "step-rest")}${button("Alternate cycles", "step-alternate")}</div>${t.setting ? '<p class="help">Draw across the event lane below to paint values. Horizontal position follows real queried event boundaries.</p><div id="paint-lane" class="paint-lane" aria-label="Draw stepped setting values">' + lane(events[t.voice.id] ?? [], t.setting.name, 70) + "</div>" : ""}`;
  } else if (p.core.kind === "constant") {
    const info = controlInfo(t.setting?.name ?? t.label),
      val = p.core.value;
    body = `<h3>${esc(info.name)}</h3><label class="constant-control">${typeof val === "number" ? `<output id="constant-output">${val} <small>${esc(info.unit)}</small></output><input id="constant-range" type="range" min="${info.min}" max="${info.max}" step="${info.step}" value="${val}">` : ""}<span>Value${info.unit ? " · " + esc(info.unit) : ""}</span><input id="constant-value" type="${typeof val === "number" ? "number" : "text"}" step="${info.step}" value="${esc(val)}"></label>`;
  } else if (p.core.kind === "signal") {
    const range = p.layers.find(
        (l) => l.kind === "rewrite" && l.name === "range",
      ),
      speed = p.layers.find(
        (l) => l.kind === "rewrite" && ["slow", "fast"].includes(l.name),
      );
    const val = (l: typeof range, i: number, f: number) =>
      l?.kind === "rewrite" && l.args[i]?.kind === "literal"
        ? l.args[i].value
        : f;
    body = `<h3>${esc(p.core.shape)} wave</h3><div class="wave-handles"><div class="wave-drawing">${lane(previewEvents, "", 90)}<button data-wave-handle="1" class="wave-high" aria-label="Drag highest value">↕ high</button><button data-wave-handle="0" class="wave-low" aria-label="Drag lowest value">↕ low</button><button data-wave-handle="2" class="wave-speed" aria-label="Drag wave speed">↔ speed</button></div><div class="fields">${["Lowest", "Highest", "Speed · cycles per wave"].map((name, i) => `<label>${name}<input data-signal="${i}" type="number" step="any" value="${esc(i < 2 ? val(range, i, i === 0 ? 0 : 1) : val(speed, 0, 1))}"></label>`).join("")}</div></div><p class="help">The wave is sampled by Strudel at real note onsets. Handles change its range and period.</p>`;
  } else if (p.core.kind === "data") {
    body = `<h3>Structured value</h3><label class="label">JSON VALUE<textarea id="data-value">${esc(JSON.stringify(p.core.value, null, 2))}</textarea></label>`;
  } else if (p.core.kind === "ref") {
    body = `<h3>Shared pattern · ${esc(p.core.name)}</h3>${doc().shared[p.core.name] ? button("Inspect shared pattern", "select", `data-id="${doc().shared[p.core.name]!.id}"`) : '<div class="error-box">Missing shared definition</div>'}`;
  } else if (p.core.kind === "group") {
    body = `<h3>${esc(p.core.how)} contains</h3><div class="driver-tree">${p.core.parts.map((x, i) => button(`Part ${i + 1}${x.cycles ? " · " + x.cycles + " cycles" : ""}`, "select", `data-id="${x.pattern.id}"`)).join("")}</div>`;
  } else body = "<p>Select a child to inspect its arguments.</p>";
  const children = targets({ ...doc(), voices: [t.voice] }).filter(
    (x) => x.parent?.id === p.id && x.id !== t.id && "core" in x.node,
  );
  return `<section class="editor" role="dialog" aria-modal="true" aria-label="Edit ${esc(t.path.join(" › "))}"><div class="editor-head"><div><p class="eyebrow">ONE THING AT A TIME · ${kind}</p><h2 id="breadcrumb">${esc(t.path.join(" › "))}</h2></div>${button("Done ×", "done", 'class="done"')}</div><div class="editor-scroll"><div class="voice-preview"><div><span class="label">REAL RESULT · CYCLE ${cycle} · ${esc(t.voice.name)}</span>${errors[t.voice.id] ? `<div class="error-box">⚠ BROKEN · ${esc(errors[t.voice.id])}</div>` : lane(events[t.voice.id] ?? [], "", 60)}<div class="axis-labels"><span>start</span><span>½ cycle</span><span>end</span></div></div><figure>${ring(events[t.voice.id] ?? [])}<figcaption>read-only</figcaption></figure></div><div id="editor-error" role="alert">${warning ? `<p class="error-box">${esc(warning)}</p>` : ""}</div>${body}${t.setting ? `<div class="driver-tree"><span class="label">WHAT DRIVES ${esc(t.setting.name)}?</span>${button(`${esc(t.setting.value.core.kind)} › inspect`, "select", `data-id="${t.setting.value.id}"`)}${["constant", "sequence", "signal"].map((x) => button(`Use ${x}`, "driver", `data-kind="${x}"`)).join("")}</div>` : ""}${children.length ? `<div class="driver-tree"><span class="label">NESTED DRIVERS · FOLLOW TO INSPECT</span>${children.map((x) => button(esc(x.path.slice(t.path.length).join(" › ") || x.label), "select", `data-id="${x.id}"`)).join("")}</div>` : ""}<div class="context"><span class="label">OTHER SETTINGS · SELECT TO EDIT</span>${settings(
    t.voice,
  )
    .filter((s) => s.id !== t.setting?.id)
    .map(
      (s) =>
        `<div class="context-row">${button(esc(s.name), "select", `data-id="${s.id}"`)}${lane(events[t.voice.id] ?? [], s.name, 22)}</div>`,
    )
    .join(
      "",
    )}</div><div class="add-section"><h3>Add to ${esc(t.voice.name)}</h3>${button("+ Setting", "add-setting")}${button("+ Rewrite shell", "add-shell")}${adding ? addForm() : ""}</div><details><summary>Generated Strudel · read-only</summary><pre>${esc(generate(doc()))}</pre></details></div><div class="editor-foot"><label>WHEN CHANGES LAND<select id="apply-mode"><option value="now" ${mode === "now" ? "selected" : ""}>Apply now · scheduled notes may keep old values</option><option value="next" ${mode === "next" ? "selected" : ""}>Apply at next uncommitted cycle</option></select></label><span id="editor-pending">${pending ? `◌ PENDING · onset at/after ${pending.first.toFixed(2)}` : "● Up to date"}</span></div></section>`;
}
function stepValue(steps: Step[], path: number[]): Step | undefined {
  let s: Step | undefined;
  for (const i of path) {
    s = steps[i];
    if (s && "steps" in s) steps = s.steps;
  }
  return s;
}
const controls = Object.keys(core.controls).filter((n) =>
  core.isControlName(n),
);
const common = [
  "lpf",
  "gain",
  "pan",
  "s",
  "note",
  "room",
  "roomsize",
  "orbit",
  "delay",
  "delaytime",
  "delayfeedback",
  "hpf",
  "crush",
  "distort",
  "release",
];
function addForm() {
  const list =
    adding === "shell"
      ? ["fast", "slow", "late", "rev", "euclid", "degradeBy"]
      : [...new Set([...common, ...controls.sort()])];
  return `<div class="add-form"><label>Search ${adding === "shell" ? "rewrites" : "Strudel control registry"}<input id="add-search" type="search" value="${esc(addQuery)}"></label><div id="add-results">${list
    .filter((x) => x.toLowerCase().includes(addQuery.toLowerCase()))
    .slice(0, 40)
    .map((n) =>
      button(
        `${n}${common.includes(n) && adding === "setting" ? " · common" : ""}`,
        "add-choice",
        `data-name="${n}"`,
      ),
    )
    .join("")}</div></div>`;
}
async function refresh() {
  const token = ++serial;
  busy = true;
  const d = doc(),
    c = cycle;
  const tagged = tagVoices(d, true);
  const r = await queryEvents(generate(tagged), c, c + 1);
  if (token !== serial) return;
  events = Object.fromEntries(d.voices.map((v) => [v.id, []]));
  errors = {};
  for (const e of r.events) {
    const id = String(valueAt(e, "__voice") ?? d.voices[0]?.id ?? "setup");
    (events[id] ??= []).push(e);
  }
  if (r.error) for (const v of d.voices) errors[v.id] = r.error;
  const t = selectedTarget();
  before = [];
  after = [];
  previewEvents = [];
  if (t) {
    const l =
      "kind" in t.node && t.node.kind === "rewrite" ? t.node : undefined;
    try {
      if (l && t.layerIndex !== undefined) {
        const a = await queryEvents(
            generate({
              ...d,
              order: undefined,
              voices: [
                {
                  ...t.voice,
                  pattern: {
                    ...t.pattern,
                    layers: t.pattern.layers.slice(0, t.layerIndex),
                  },
                },
              ],
            }),
            c,
            c + 1,
          ),
          b = await queryEvents(
            generate({
              ...d,
              order: undefined,
              voices: [
                {
                  ...t.voice,
                  pattern: {
                    ...t.pattern,
                    layers: t.pattern.layers.slice(0, t.layerIndex + 1),
                  },
                },
              ],
            }),
            c,
            c + 1,
          );
        before = a.events;
        after = b.events;
      }
      if (t.pattern.core.kind === "signal") {
        const r = await queryEvents(
          generate({
            ...d,
            order: undefined,
            voices: [
              {
                ...t.voice,
                pattern: {
                  ...t.pattern,
                  layers: [...t.pattern.layers, shell("segment", [64])],
                },
              },
            ],
          }),
          c,
          c + 1,
        );
        previewEvents = r.events;
      }
    } catch (e) {
      warning = String(e);
    }
  }
  busy = false;
  const active = document.activeElement;
  const focus =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? {
          id: active.id,
          value: active.value,
          start: active.selectionStart,
          end: active.selectionEnd,
        }
      : undefined;
  const scroll = document.querySelector(".editor-scroll")?.scrollTop ?? 0;
  render();
  const panel = document.querySelector(".editor-scroll");
  if (panel) panel.scrollTop = scroll;
  if (focus?.id) {
    const el = document.getElementById(focus.id);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      if (
        el.type === "text" ||
        el.type === "search" ||
        el instanceof HTMLTextAreaElement
      ) {
        if (focus.start !== null && focus.end !== null)
          el.setSelectionRange(focus.start, focus.end);
      }
    }
  }
}
async function changed(next: Doc, id = selected) {
  const previous = playDoc();
  history.set(next);
  revision++;
  warning = "";
  const changedVoice = target(id)?.voice.id;
  const r = engine.revision + 1;
  pending = engine.playing
    ? {
        id,
        revision: r,
        first: Math.max(
          engine.horizon(),
          engine.phase() + (0.3 * (doc().tempo?.cpm ?? 32)) / 60,
        ),
        queued: mode === "next",
      }
    : undefined;
  if (engine.playing) {
    try {
      if (mode === "next") {
        const boundary = Math.max(
          Math.floor(engine.phase()) + 1,
          Math.ceil(engine.horizon()),
        );
        pending!.first = boundary;
        pending!.queued = false;
        await engine.swap(atBoundary(previous, playDoc(), boundary));
      } else await engine.swap(playDoc());
    } catch (e) {
      warning = String(e);
      pending = undefined;
    }
  }
  changeLog.push({
    revision,
    state: pending ? "pending" : "preview",
    cycle: phase,
  });
  await refresh();
}
function playDoc(): Doc {
  const d = tagVoices(doc());
  return solo
    ? {
        ...d,
        voices: d.voices.map((v) => ({
          ...v,
          pattern: {
            ...v.pattern,
            layers: [
              ...v.pattern.layers,
              {
                id: "solo-" + v.id,
                tier: 3,
                kind: "opaque",
                code: `.filterValues(v=>v.__planet==='${solo}'||v.__voice==='${solo}')`,
              },
            ],
          },
        })),
      }
    : d;
}

async function choose(id: string) {
  const t = target(id);
  const c = t?.voice.pattern.core;
  if (
    t &&
    (id === t.voice.id || id === t.voice.pattern.id) &&
    !t.voice.pattern.layers.some(
      (l) =>
        l.kind === "rewrite" &&
        ["euclid", "degradeBy", "sometimes", "every"].includes(l.name),
    ) &&
    c?.kind === "generator" &&
    ["note", "s", "n"].includes(c.name) &&
    c.args[0]?.kind === "pattern"
  )
    id = c.args[0].pattern.id;
  selected = id;
  open = true;
  editPath = [0];
  adding = "";
  warning = "";
  await refresh();
  const scroll = document.querySelector(".editor-scroll");
  if (scroll) scroll.scrollTop = 0;
  document.querySelector<HTMLButtonElement>(".done")?.focus();
}
async function edit(fn: (t: Target) => void) {
  await changed(update(doc(), selected, fn));
}
function bind() {
  document.querySelectorAll<HTMLElement>("[data-action]").forEach(
    (el) =>
      (el.onclick = () => {
        const action = el.dataset.action,
          id = el.dataset.id;
        handle(action ?? "", id, el).catch((e) => {
          warning = String(e);
          render();
        });
      }),
  );
  document.querySelectorAll<SVGElement>("[data-select]").forEach((el) => {
    el.onclick = () => choose(el.dataset.select ?? "").catch(fail);
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose(el.dataset.select ?? "").catch(fail);
      }
    };
  });
  document.querySelectorAll<SVGElement>("[data-collapse]").forEach((el) => {
    const fn = () => {
      const id = el.dataset.collapse ?? "";
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      render();
    };
    el.onclick = fn;
    el.onkeydown = (e) => {
      if (e.key === "Enter") fn();
    };
  });
  const on = (s: string, event: string, fn: (e: Event) => void) =>
    document.querySelector(s)?.addEventListener(event, fn);
  on("#piece", "change", (e) => {
    const f = [...fixtures, ...corpusDocs].find(
      (f) => f.id === (e.target as HTMLSelectElement).value,
    );
    if (f) {
      engine.stop();
      history.set(structuredClone(f.doc));
      piece = f.id;
      selected = "";
      rowOrder = [];
      open = false;
      cycle = 0;
      phase = 0;
      pending = undefined;
      query = "";
      zoom = Math.min(
        1,
        (window.innerWidth - (window.innerWidth > 650 ? 240 : 0)) /
          (window.innerWidth <= 650 ? 400 : 1200),
      );
      pan = { x: 0, y: 0 };
      refresh().catch(fail);
    }
  });
  on("#find", "input", (e) => {
    query = (e.target as HTMLInputElement).value;
    const el = e.target as HTMLInputElement;
    const pos = el.selectionStart;
    render();
    const n = document.querySelector<HTMLInputElement>("#find");
    n?.focus();
    if (pos !== null) n?.setSelectionRange(pos, pos);
  });
  on("#apply-mode", "change", (e) => {
    mode = (e.target as HTMLSelectElement).value;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(
    (el) =>
      (el.onclick = () => {
        editPath = el.dataset.step!.split(".").map(Number);
        render();
      }),
  );
  on("#data-value", "change", (e) =>
    edit((t) => {
      if (t.pattern.core.kind === "data")
        t.pattern.core.value = JSON.parse(
          (e.target as HTMLTextAreaElement).value,
        );
    }).catch(fail),
  );
  on("#step-value", "change", (e) =>
    edit((t) =>
      changeStep(
        t.pattern,
        editPath,
        "value",
        (e.target as HTMLInputElement).value,
      ),
    ).catch(fail),
  );
  on("#step-weight", "change", (e) =>
    edit((t) =>
      changeStep(
        t.pattern,
        editPath,
        "weight",
        (e.target as HTMLInputElement).value,
      ),
    ).catch(fail),
  );
  on("#constant-value", "change", (e) => {
    const value = (e.target as HTMLInputElement).value;
    edit((t) => {
      if (t.pattern.core.kind === "constant")
        t.pattern.core.value =
          typeof t.pattern.core.value === "number" ? Number(value) : value;
    }).catch(fail);
  });
  on("#constant-range", "input", (e) => {
    const el = e.target as HTMLInputElement;
    const output = document.querySelector("#constant-output");
    if (output) output.textContent = el.value;
  });
  on("#constant-range", "change", (e) =>
    edit((t) => {
      if (t.pattern.core.kind === "constant")
        t.pattern.core.value = Number((e.target as HTMLInputElement).value);
    }).catch(fail),
  );
  document.querySelectorAll<HTMLInputElement>("[data-arg]").forEach(
    (el) =>
      (el.onchange = () =>
        edit((t) => {
          const l =
            el.dataset.prefix === "layer" &&
            "kind" in t.node &&
            t.node.kind === "rewrite"
              ? t.node
              : el.dataset.prefix === "rule"
                ? t.pattern.layers.find(
                    (l) =>
                      l.kind === "rewrite" &&
                      ["euclid", "degradeBy", "sometimes", "every"].includes(
                        l.name,
                      ),
                  )
                : undefined;
          const args =
            l && "args" in l
              ? l.args
              : t.pattern.core.kind === "generator"
                ? t.pattern.core.args
                : [];
          const a = args[Number(el.dataset.arg)];
          if (a?.kind === "literal")
            a.value =
              typeof a.value === "number"
                ? Number(el.value)
                : typeof a.value === "boolean"
                  ? el.value === "true"
                  : el.value;
        }).catch(fail)),
  );
  document.querySelectorAll<HTMLTextAreaElement>("[data-arg-source]").forEach(
    (el) =>
      (el.onchange = () =>
        edit((t) => {
          const n = t.node;
          const args =
            "kind" in n && n.kind === "rewrite"
              ? n.args
              : t.pattern.core.kind === "generator"
                ? t.pattern.core.args
                : [];
          const a = args[Number(el.dataset.argSource)];
          if (a?.kind === "opaque") a.code = el.value;
        }).catch(fail)),
  );
  document.querySelectorAll<HTMLInputElement>("[data-signal]").forEach(
    (el) =>
      (el.onchange = () =>
        edit((t) => {
          const i = Number(el.dataset.signal),
            name = i === 2 ? "slow" : "range";
          let l = t.pattern.layers.find(
            (l) => l.kind === "rewrite" && l.name === name,
          );
          if (!l) {
            l = shell(name, i === 2 ? [1] : [0, 1]);
            t.pattern.layers.push(l);
          }
          if (l.kind === "rewrite")
            l.args[i === 2 ? 0 : i] = {
              kind: "literal",
              value: Number(el.value),
            };
        }).catch(fail)),
  );
  let timer: ReturnType<typeof setTimeout>;
  on("#opaque-code", "input", (e) => {
    const value = (e.target as HTMLTextAreaElement).value;
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        edit((t) => {
          const n = t.node;
          if ("code" in n) n.code = value;
          else if (t.pattern.core.kind === "opaque")
            t.pattern.core.code = value;
        }).catch(fail),
      450,
    );
  });
  on("#add-search", "input", (e) => {
    addQuery = (e.target as HTMLInputElement).value;
    const old = document.querySelector(".add-form");
    if (old) {
      old.outerHTML = addForm();
      bindAdd();
    }
  });
  bindPaint();
  bindWave();
  bindPan();
}
function bindAdd() {
  document
    .querySelectorAll<HTMLButtonElement>('[data-action="add-choice"]')
    .forEach(
      (el) =>
        (el.onclick = () => handle("add-choice", undefined, el).catch(fail)),
    );
  const input = document.querySelector<HTMLInputElement>("#add-search");
  if (input) {
    input.oninput = () => {
      addQuery = input.value;
      document.querySelector(".add-form")!.outerHTML = addForm();
      bindAdd();
    };
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}
async function handle(action: string, id?: string, el?: HTMLElement) {
  const t = selectedTarget();
  switch (action) {
    case "select":
      if (id) await choose(id);
      break;
    case "done":
      open = false;
      adding = "";
      render();
      break;
    case "map-a":
      map = "constellation";
      render();
      break;
    case "map-b":
      map = "sheet";
      render();
      break;
    case "play":
      if (engine.playing) {
        engine.stop();
        pending = undefined;
        queued = undefined;
      } else {
        await engine.play(playDoc());
      }
      render();
      break;
    case "undo":
      history.undo();
      pending = undefined;
      queued = undefined;
      if (engine.playing) await engine.swap(playDoc());
      await refresh();
      break;
    case "redo":
      history.redo();
      if (engine.playing) await engine.swap(playDoc());
      await refresh();
      break;
    case "add-voice":
      await changed(addVoice(doc()));
      break;
    case "paste":
      paste = true;
      render();
      break;
    case "cancel-paste":
      paste = false;
      render();
      break;
    case "import": {
      const s =
        document.querySelector<HTMLTextAreaElement>("#paste-source")?.value ??
        "";
      const r = importStrudel(s);
      engine.stop();
      history.set(r.doc);
      warning = r.warnings.join(" ");
      paste = false;
      piece = "paste";
      selected = r.doc.voices[0]?.id ?? "";
      open = !!selected;
      await refresh();
      break;
    }
    case "zoom-in":
      zoom = Math.min(2, zoom * 1.2);
      render();
      break;
    case "zoom-out":
      zoom = Math.max(0.35, zoom / 1.2);
      render();
      break;
    case "fit":
      zoom = Math.min(
        1,
        (document.querySelector(".map-container")?.clientWidth ?? 1200) /
          (window.innerWidth <= 650 ? 400 : 1200),
      );
      pan = { x: 0, y: 0 };
      render();
      break;
    case "focus": {
      if (map === "sheet") {
        document
          .querySelector(`[data-id="${id}"].name`)
          ?.scrollIntoView({ block: "center", inline: "start" });
      } else {
        const g = document.querySelector(`[data-select="${id}"]`);
        g?.scrollIntoView({ block: "center", inline: "center" });
      }
      break;
    }
    case "collapse":
      if (id) {
        collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
        render();
      }
      break;
    case "mute":
      if (id) await changed(toggleMute(doc(), id), id);
      break;
    case "solo":
      solo = solo === id ? "" : (id ?? "");
      if (engine.playing) await engine.swap(playDoc());
      render();
      break;
    case "row-up":
    case "row-down": {
      const rows = sheet(doc(), events).rows.map((r) => r.voice.id);
      if (!rowOrder.length) rowOrder = rows;
      const i = rowOrder.indexOf(id ?? ""),
        j = i + (action === "row-up" ? -1 : 1),
        a = rowOrder[i],
        b = rowOrder[j];
      if (a && b) {
        rowOrder[i] = b;
        rowOrder[j] = a;
        render();
      }
      break;
    }
    case "step-split":
    case "step-merge":
    case "step-rest":
    case "step-alternate":
      await edit((t) =>
        changeStep(
          t.pattern,
          editPath,
          action.slice(5) as "split" | "merge" | "rest" | "alternate",
        ),
      );
      break;
    case "shell-in":
    case "shell-out":
      await changed(moveShell(doc(), selected, action === "shell-in" ? -1 : 1));
      break;
    case "shell-remove":
      if (t) {
        await edit((t) => {
          if (t.layerIndex !== undefined)
            t.pattern.layers.splice(t.layerIndex, 1);
        });
        selected = t.voice.id;
        await refresh();
      }
      break;
    case "driver": {
      const kind = el?.dataset.kind;
      if (kind === "signal" || kind === "sequence" || kind === "constant")
        await edit((t) => makeDriver(t, kind));
      break;
    }
    case "add-setting":
    case "add-shell":
      adding = action === "add-setting" ? "setting" : "shell";
      addQuery = "";
      render();
      document.querySelector<HTMLInputElement>("#add-search")?.focus();
      break;
    case "add-choice":
      if (t && el?.dataset.name) {
        const d =
          adding === "setting"
            ? addSetting(doc(), ownerId(doc(), t), el.dataset.name)
            : addShell(doc(), ownerId(doc(), t), el.dataset.name);
        adding = "";
        await changed(d);
      }
      break;
  }
}
function bindPaint() {
  const el = document.querySelector<HTMLElement>("#paint-lane");
  if (!el) return;
  let painting = false,
    draft: Doc | undefined;
  const paint = (e: PointerEvent) => {
    if (!draft) return;
    const t = targets(draft).find((x) => x.id === selected);
    if (!t || t.pattern.core.kind !== "sequence") return;
    const rect = el.getBoundingClientRect(),
      x = Math.max(0, Math.min(0.99999, (e.clientX - rect.left) / rect.width)),
      y = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const info = controlInfo(t.setting?.name ?? "lpf");
    paintSequence(t.pattern, x, info.min + y * (info.max - info.min), cycle);
  };
  el.onpointerdown = (e) => {
    painting = true;
    gestureActive = true;
    draft = structuredClone(doc());
    el.setPointerCapture(e.pointerId);
    paint(e);
  };
  el.onpointermove = (e) => {
    if (painting) paint(e);
  };
  el.onpointerup = () => {
    painting = false;
    gestureActive = false;
    if (draft) changed(draft).catch(fail);
    draft = undefined;
  };
  el.onpointercancel = () => {
    painting = false;
    gestureActive = false;
    draft = undefined;
  };
}
function bindWave() {
  document
    .querySelectorAll<HTMLButtonElement>("[data-wave-handle]")
    .forEach((el) => {
      let start: { x: number; y: number; value: number } | undefined;
      const i = Number(el.dataset.waveHandle),
        input = () =>
          document.querySelector<HTMLInputElement>(`[data-signal="${i}"]`);
      el.onpointerdown = (e) => {
        const field = input();
        if (!field) return;
        start = { x: e.clientX, y: e.clientY, value: Number(field.value) };
        gestureActive = true;
        el.setPointerCapture(e.pointerId);
      };
      el.onpointermove = (e) => {
        if (!start) return;
        const field = input();
        if (field) {
          field.value = String(
            i === 2
              ? Math.max(
                  0.125,
                  Math.round((start.value + (e.clientX - start.x) / 40) * 8) /
                    8,
                )
              : Math.max(
                  0,
                  Math.round(start.value + (start.y - e.clientY) * 30),
                ),
          );
          el.textContent = `${i === 2 ? "speed" : i === 1 ? "high" : "low"} ${field.value}`;
        }
      };
      el.onpointerup = () => {
        if (start) {
          start = undefined;
          gestureActive = false;
          input()?.dispatchEvent(new Event("change"));
        }
      };
      el.onpointercancel = () => {
        start = undefined;
        gestureActive = false;
      };
    });
}
function bindPan() {
  const el = document.querySelector<HTMLElement>("#space"),
    svg = document.querySelector<SVGElement>("#universe");
  if (!el || !svg) return;
  let drag: { x: number; y: number; px: number; py: number } | undefined;
  el.onpointerdown = (e) => {
    if ((e.target as Element).closest("[data-select],[data-collapse]")) return;
    drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    el.setPointerCapture(e.pointerId);
  };
  el.onpointermove = (e) => {
    if (drag) {
      pan = {
        x: drag.px + e.clientX - drag.x,
        y: drag.py + e.clientY - drag.y,
      };
      svg.style.transform = `translate(${pan.x}px,${pan.y}px)`;
    }
  };
  el.onpointerup = () => {
    drag = undefined;
  };
}
function fail(e: unknown) {
  warning = e instanceof Error ? e.message : String(e);
  render();
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && open) {
    open = false;
    render();
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key === "z" &&
    !(
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    )
  ) {
    e.preventDefault();
    handle(e.shiftKey ? "redo" : "undo").catch(fail);
  }
});
let lastCycle = 0;
function tick() {
  if (engine.playing) {
    phase = engine.phase();
    const c = Math.floor(phase);
    if (c !== lastCycle) {
      lastCycle = c;
      cycle = c;
      if (queued) {
        const next = queued;
        queued = undefined;
        if (pending) {
          pending.queued = false;
          pending.revision = engine.revision + 1;
        }
        engine
          .swap(
            tagVoices(
              solo
                ? {
                    ...next,
                    voices: next.voices.map((v) => ({
                      ...v,
                      muted: v.id !== solo || v.muted,
                    })),
                  }
                : next,
            ),
          )
          .catch(fail);
      }
      refresh().catch(fail);
    }
    const clock = document.querySelector("#clock");
    if (clock)
      clock.textContent = `${String(cycle).padStart(2, "0")} / ${(phase % 1).toFixed(2)}`;
    document
      .querySelectorAll<SVGPathElement>(".playline")
      .forEach((p) => p.setAttribute("d", `M${(phase % 1) * 300} 0V100`));
    document
      .querySelectorAll<SVGPathElement>(".ringhead")
      .forEach((p) =>
        p.setAttribute(
          "d",
          `M50 50L${50 + Math.cos((phase % 1) * Math.PI * 2 - Math.PI / 2) * 41} ${50 + Math.sin((phase % 1) * Math.PI * 2 - Math.PI / 2) * 41}`,
        ),
      );
    if (pending && !pending.queued) {
      const p = pending;
      const onset = engine.dispatches.find(
        (d) =>
          d.revision >= p.revision &&
          d.begin >= p.first &&
          d.target <= engine.audioTime() &&
          (!target(p.id) ||
            String(
              d.value && typeof d.value === "object"
                ? Reflect.get(d.value, "__voice")
                : "",
            ) === target(p.id)?.voice.id),
      );
      if (onset) {
        pending = undefined;
        changeLog.push({ revision, state: "landed", cycle: phase });
        document
          .querySelectorAll(".pending")
          .forEach((el) => el.classList.remove("pending"));
        for (const id of ["#pending", "#editor-pending"]) {
          const el = document.querySelector(id);
          if (el) el.textContent = "● Change landed · first dispatched onset";
        }
      }
    }
  }
  requestAnimationFrame(tick);
}
Object.assign(window, {
  editorStudy: {
    get document() {
      return doc();
    },
    get events() {
      return events;
    },
    get errors() {
      return errors;
    },
    get busy() {
      return busy;
    },
    get selected() {
      return selected;
    },
    get pending() {
      return pending;
    },
    get source() {
      return generate(doc());
    },
    get changeLog() {
      return changeLog;
    },
    engine,
    choose,
    refresh,
    get targets() {
      return targets(doc());
    },
    setStudy: async (n: number) => {
      const f = fixtures.find(
        (f) => f.id === (n === 20 ? "twenty" : n === 8 ? "eight" : "three"),
      )!;
      const d = structuredClone(f.doc);
      d.voices[1]!.pattern = structuredClone(
        fixtures[3]!.doc.voices[1]!.pattern,
      );
      d.voices[2]!.pattern = structuredClone(
        fixtures[3]!.doc.voices[2]!.pattern,
      );
      d.voices[0]!.pattern.layers.push({ ...shell("slow", [1]), tier: 2 });
      engine.stop();
      history.set(d);
      selected = "";
      open = false;
      query = "";
      pending = undefined;
      cycle = 0;
      phase = 0;
      await refresh();
    },
    setCorpus: async (id: string) => {
      const f = corpusDocs.find((f) => f.id === id);
      if (!f) throw Error("No corpus piece");
      engine.stop();
      history.set(structuredClone(f.doc));
      piece = id;
      selected = "";
      rowOrder = [];
      open = false;
      cycle = 0;
      phase = 0;
      query = "";
      warning = f.warnings.join(" ");
      await refresh();
    },
    get corpus() {
      return corpusDocs.map((f) => f.id);
    },
    setFixture: async (id: string) => {
      const f = fixtures.find((f) => f.id === id);
      if (!f) throw Error("No fixture");
      engine.stop();
      history.set(structuredClone(f.doc));
      piece = id;
      cycle = 0;
      phase = 0;
      lastCycle = 0;
      selected = "";
      query = "";
      open = false;
      pending = undefined;
      zoom = Math.min(
        1,
        (window.innerWidth - (window.innerWidth > 650 ? 240 : 0)) /
          (window.innerWidth <= 650 ? 400 : 1200),
      );
      await refresh();
    },
  },
});
render();
refresh().catch(fail);
tick();
